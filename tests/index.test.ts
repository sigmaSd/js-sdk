import createPlugin, { CurrentPlugin, ExtismPlugin, ExtismPluginOptions, Manifest, ManifestWasm } from '../src/node/index';

async function newPlugin(
  moduleName: string | Manifest | ManifestWasm | Buffer,
  optionsConfig?: (opts: ExtismPluginOptions) => void): Promise<ExtismPlugin> {
  const options: ExtismPluginOptions = {
    useWasi: true,
    runtime: {
      url: 'wasm/extism-runtime.wasm',
    },
  }

  if (optionsConfig) {
    optionsConfig(options);
  }

  let module: Manifest | ManifestWasm | Buffer;
  if (typeof moduleName == 'string') {
    module = {
      url: `wasm/${moduleName}`,
    };
  } else {
    module = moduleName;
  }

  const plugin = await createPlugin(module, options);
  return plugin;
}

function decode(buffer: Uint8Array) {
  const decoder = new TextDecoder();
  return decoder.decode(buffer);
}

describe('test extism', () => {
  test('can create plugin from string', async () => {
    const plugin = await createPlugin("wasm/code.wasm", {
      useWasi: true
    });
    
    expect(await plugin.functionExists('count_vowels')).toBe(true);
  });

  test('can create plugin from url with hash check', async () => {
    const plugin = await newPlugin({
      url: "https://raw.githubusercontent.com/extism/extism/main/wasm/code.wasm",
      hash: "7def5bb4aa3843a5daf5d6078f1e8540e5ef10b035a9d9387e9bd5156d2b2565"
    });

    expect(await plugin.functionExists('count_vowels')).toBe(true);
  });

  test('can create plugin from url', async () => {
    const plugin = await newPlugin({
      url: "https://raw.githubusercontent.com/extism/extism/main/wasm/code.wasm",
    });

    expect(await plugin.functionExists('count_vowels')).toBe(true);
  });

  test('fails on hash mismatch', async () => {
    await expect(newPlugin({
      url: "wasm/code.wasm",
      name: "code",
      hash: "-----------"
    })).rejects.toThrow(/Plugin error/);
  });

  test('can use embedded runtime', async () => {
    let module = {
      url: `wasm/code.wasm`,
    };

    const plugin = await createPlugin(module, {
      useWasi: true
    });

    let output = await plugin.call('count_vowels', 'this is a test');

    let result = JSON.parse(decode(output));
    expect(result['count']).toBe(4);
  });

  test('can create and call a plugin', async () => {
    const plugin = await newPlugin('code.wasm');
    let output = await plugin.call('count_vowels', 'this is a test');

    let result = JSON.parse(decode(output));
    expect(result['count']).toBe(4);
    output = await plugin.call('count_vowels', 'this is a test again');
    result = JSON.parse(decode(output));
    expect(result['count']).toBe(7);
    output = await plugin.call('count_vowels', 'this is a test thrice');
    result = JSON.parse(decode(output));
    expect(result['count']).toBe(6);
    output = await plugin.call('count_vowels', '🌎hello🌎world🌎');
    result = JSON.parse(decode(output));
    expect(result['count']).toBe(3);
  });

  test('can detect if function exists or not', async () => {
    const plugin = await newPlugin('code.wasm');
    expect(await plugin.functionExists('count_vowels')).toBe(true);
    expect(await plugin.functionExists('i_dont_extist')).toBe(false);
  });

  test('errors when function is not known', async () => {
    const plugin = await newPlugin('code.wasm');
    await expect(plugin.call('i_dont_exist', 'example-input')).rejects.toThrow();
  });

  test('plugin can allocate memory', async () => {
    const plugin = await newPlugin('alloc.wasm');
    await plugin.call("run_test", "")
  });

  test('plugin can fail gracefuly', async () => {
    const plugin = await newPlugin('fail.wasm');
    await expect(() => plugin.call("run_test", "")).rejects.toThrowError(/Call error/);
  });

  test('host functions works', async () => {
    const plugin = await newPlugin('code-functions.wasm', options => {
      options.functions = {
        "env": {
          "hello_world": function (cp: CurrentPlugin, off: bigint) {
            const result = JSON.parse(cp.readString(off) ?? '');
            result['message'] = 'hello from host!';
            return plugin.currentPlugin.writeString(JSON.stringify(result));
          }
        }
      }
    });

    const output = await plugin.call('count_vowels', 'aaa');
    const result = JSON.parse(decode(output));

    expect(result).toStrictEqual({
      count: 3,
      message: "hello from host!"
    })
  });

  test('can deny http requests', async () => {
    const plugin = await newPlugin('http.wasm');
    await expect(() => plugin.call("run_test", "")).rejects.toThrowError(/Call error/);
  });

  test('can allow http requests', async () => {
    const plugin = await newPlugin('http.wasm', options => {
      options.allowedHosts = ['*.typicode.com'];
    });

    const output = await plugin.call("run_test", "");
    const result = JSON.parse(decode(output));

    expect(result.id).toBe(1);
  });

  test('can log messages', async () => {
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
    console.debug = jest.fn();

    const plugin = await newPlugin('log.wasm', options => {
      options.allowedHosts = ['*.typicode.com'];
    });

    const _ = await plugin.call("run_test", "");

    expect(console.log).toHaveBeenCalledWith("this is an info log");
    expect(console.warn).toHaveBeenCalledWith("this is a warning log");
    expect(console.error).toHaveBeenCalledWith("this is an erorr log");
    expect(console.debug).toHaveBeenCalledWith("this is a debug log");
  });

  test('can initialize haskell runtime', async () => {
    console.trace = jest.fn();

    const plugin = await newPlugin('hello_haskell.wasm', options => {
      options.config = { 'greeting': 'Howdy' };
    });

    {
      const output = await plugin.call("testing", "John");
      const result = decode(output);

      expect(result).toBe("Howdy, John")
    }

    {
      const output = await plugin.call("testing", "Ben");
      const result = decode(output);

      expect(result).toBe("Howdy, Ben")
    }

    expect(console.debug).toHaveBeenCalledWith("Haskell (normal) runtime detected.");
  });

  test('can read file', async () => {
    const plugin = await newPlugin('fs.wasm', options => {
      options.allowedPaths = { '/mnt': 'tests/data' };
    });

    const output = await plugin.call("run_test", "");
    const result = decode(output);

    expect(result).toBe("hello world!");
  });
});
