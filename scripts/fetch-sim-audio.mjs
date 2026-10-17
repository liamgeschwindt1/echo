// Fetches the non-commercial clips only for builds that include the simulator.
if (process.env.SIM_ENABLED === '1') await import('./fetch-test-audio.mjs');
else console.log('SIM_ENABLED is not 1: simulator and its clips are not part of this build');
