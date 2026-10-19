/** Prints the fuzz links for seeds <from>..<from+n-1> as a JSON array (scripts/fuzz.mjs, browser mode). */
import '../../tests/jsdomEnv';

const from = Number(process.argv[2]) || 1;
const n = Number(process.argv[3]) || 1;
const { fuzzLink } = await import('../../src/dev/fuzzLinks');
console.log('FUZZLINKS ' + JSON.stringify(Array.from({ length: n }, (_, i) => fuzzLink(from + i))));
process.exit(0);
