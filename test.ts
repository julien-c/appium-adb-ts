import ADB from './lib/adb';

(async () => {
	const adb = await ADB.createADB();
	adb.systemCalls.setDeviceId("00b05e732e8521ef");
	console.log(adb.executable.path);
	console.log(await adb.adbCommands.getPIDsByName('m.android.phone'));
	console.log(await adb.systemCalls.getConnectedDevices());
})();

