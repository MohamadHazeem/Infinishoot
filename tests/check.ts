/** Tiny assertion helper for the test scripts: prints ok/FAIL and sets the exit code. */
export function ok(cond: boolean, msg: string): void {
  if (cond) console.log('ok   ' + msg);
  else {
    console.error('FAIL ' + msg);
    process.exitCode = 1;
  }
}
