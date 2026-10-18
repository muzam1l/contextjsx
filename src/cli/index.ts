#!/usr/bin/env node
import { run } from 'contextjsx/emit';
import { app } from './app';

// Not top-level await: rolldown turns off chunk merging for the whole build when any module uses it.
void run(app, process.argv.slice(2)).then(code => (process.exitCode = code));
