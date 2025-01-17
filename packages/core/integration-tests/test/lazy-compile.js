import assert from 'assert';
import path from 'path';
import {
  bundler,
  outputFS,
  distDir,
  getNextBuild,
  assertBundles,
  removeDistDirectory,
  run,
} from '@parcel/test-utils';

const findBundle = (bundleGraph, nameRegex) => {
  return bundleGraph.getBundles().find(b => nameRegex.test(b.name));
};

const distDirIncludes = async matches => {
  const files = await outputFS.readdir(distDir);
  for (const match of matches) {
    if (typeof match === 'string') {
      if (!files.some(file => file === match)) {
        throw new Error(
          `No file matching ${match} was found in ${files.join(', ')}`,
        );
      }
    } else {
      if (!files.some(file => match.test(file))) {
        throw new Error(
          `No file matching ${match} was found in ${files.join(', ')}`,
        );
      }
    }
  }
  return true;
};

describe('lazy compile', function () {
  it('should lazy compile', async function () {
    const b = await bundler(
      path.join(__dirname, '/integration/lazy-compile/index.js'),
      {
        shouldBuildLazily: true,
        mode: 'development',
        shouldContentHash: false,
      },
    );

    await removeDistDirectory();

    const subscription = await b.watch();
    let result = await getNextBuild(b);

    // This simulates what happens if index.js is loaded as well as lazy-1 which loads lazy-2.
    // While parallel-lazy-1 is also async imported by index.js, we pretend it wasn't requested (i.e. like
    // if it was behind a different trigger).
    result = await result.requestBundle(
      findBundle(result.bundleGraph, /index.js/),
    );
    result = await result.requestBundle(
      findBundle(result.bundleGraph, /^lazy-1/),
    );
    result = await result.requestBundle(
      findBundle(result.bundleGraph, /^lazy-2/),
    );

    // Expect the bundle graph to contain the whole nest of lazy from `lazy-1`, but not
    // `parallel-lazy-1` which wasn't requested.
    assertBundles(result.bundleGraph, [
      {
        assets: ['index.js', 'bundle-url.js', 'cacheLoader.js', 'js-loader.js'],
      },
      {
        assets: ['lazy-1.js', 'esmodule-helpers.js'],
      },
      {
        assets: ['lazy-2.js'],
      },
      {
        assets: ['parallel-lazy-1.js'],
      },
    ]);

    subscription.unsubscribe();

    // Ensure the files match the bundle graph - lazy-2 should've been produced as it was requested
    assert(await distDirIncludes(['index.js', /^lazy-1\./, /^lazy-2\./]));
  });

  it('should lazy compile properly when same module is used sync/async', async () => {
    const b = await bundler(
      path.join(__dirname, '/integration/lazy-compile/index-sync-async.js'),
      {
        shouldBuildLazily: true,
        mode: 'development',
        shouldContentHash: false,
      },
    );

    await removeDistDirectory();

    const subscription = await b.watch();
    let result = await getNextBuild(b);
    result = await result.requestBundle(
      findBundle(result.bundleGraph, /^index-sync-async\./),
    );
    result = await result.requestBundle(
      findBundle(result.bundleGraph, /^uses-static-component\./),
    );
    result = await result.requestBundle(
      findBundle(result.bundleGraph, /^uses-static-component-async\./),
    );
    result = await result.requestBundle(
      findBundle(result.bundleGraph, /^static-component\./),
    );

    let output = await run(result.bundleGraph);
    assert.deepEqual(await output.default(), [
      'static component',
      'static component',
    ]);
    subscription.unsubscribe();
  });
});
