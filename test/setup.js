// A fixed fixture timezone makes baseline tests independent of the host.
process.env.TZ='Asia/Shanghai';

// Minimal desktop host timer shim for lifecycle tests.
global.window=globalThis;
