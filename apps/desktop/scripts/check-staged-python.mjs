/**
 * After a desktop pack, confirm the staged portable Python and 阿杜 wheels are
 * present for that target. On mac-arm64 (the runner's own chip) also run
 * `pipeline.py doctor`. Usage: node check-staged-python.mjs <target> <runtimeDir>
 */
import { execFileSync } from 'node:child_process';
import { aduDoctorCommand, assertStagedRuntime, canRunPython, resolvePython } from '../src/python-runtime.mjs';

const target = process.argv[2];
const runtimeDir = process.argv[3];
if (!target || !runtimeDir) {
  throw new Error('Usage: node check-staged-python.mjs <mac-arm64|mac-x64|win-x64> <runtimeDir>');
}
const platform = target === 'win-x64' ? 'win32' : 'darwin';
assertStagedRuntime(runtimeDir, platform);
if (target === 'mac-arm64') {
  const doctor = aduDoctorCommand(resolvePython({ runtimeDir, platform, allowSystem: false }));
  if (!doctor || !canRunPython(doctor.command)) {
    throw new Error('The bundled Python could not run pipeline.py doctor on mac-arm64.');
  }
  execFileSync(doctor.command, doctor.args, { stdio: 'inherit', env: { ...process.env, PYTHONNOUSERSITE: '1' } });
}
console.log(`staged Python runtime ok (${target})`);
