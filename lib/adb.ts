import * as _ from 'lodash';
import * as os from 'os';
import * as path from 'path';
import * as tools from './tools/index';
import { rootDir } from './helpers';

const DEFAULT_ADB_PORT = 5037;
const JAR_PATH = path.resolve(rootDir, 'jars');
const DEFAULT_OPTS = {
	sdkRoot: null,
	udid: null,
	appDeviceReadyTimeout: null,
	useKeystore: null,
	keystorePath: null,
	keystorePassword: null,
	keyAlias: null,
	keyPassword: null,
	executable: { path: "adb", defaultArgs: [] },
	tmpDir: os.tmpdir(),
	curDeviceId: null,
	emulatorPort : null,
	logcat: null,
	binaries: {},
	instrumentProc: null,
	javaVersion: null,
	suppressKillServer: null,
	jars: {},
	helperJarPath: JAR_PATH,
	adbPort: DEFAULT_ADB_PORT
};

class ADB {
	sdkRoot: string;
	executable: { path: string, defaultArgs: any[] };
	curDeviceId?: string;
	suppressKillServer: boolean;
	adbPort: number;
	binaries: { [index: string]: string };
	jars: { [index: string]: string };
	adbCommands: tools.AdbCommands;
	systemCalls: tools.SystemCalls;
	// emuCommands: tools.EmuCommands;
	
	constructor(opts: any = {}) {
		if (typeof opts.sdkRoot === "undefined") {
			opts.sdkRoot = process.env.ANDROID_HOME || '';
		}
		
		Object.assign(this, opts);
		_.defaultsDeep(this, _.cloneDeep(DEFAULT_OPTS));
		
		if (opts.remoteAdbHost) {
			this.executable.defaultArgs.push("-H", opts.remoteAdbHost);
		}
		// TODO figure out why we have this option as it does not appear to be
		// used anywhere. Probably deprecate in favor of simple opts.adbPort
		if (opts.remoteAdbPort) {
			this.adbPort = opts.remoteAdbPort;
		}
		this.executable.defaultArgs.push("-P", this.adbPort);
		
		this.initJars();
		
		this.adbCommands = new tools.AdbCommands(this);
		this.systemCalls = new tools.SystemCalls(this);
		// this.emuCommands = new tools.EmuCommands(this);
	}
	
	initJars() {
		const tempJars = [
			'move_manifest.jar', 'sign.jar', 'appium_apk_tools.jar',
			'unsign.jar', 'verify.jar'
		];
		for (const jarName of tempJars) {
			this.jars[jarName] = path.resolve(JAR_PATH, jarName);
		}
	}
	
	static async createADB(opts = {}) {
		const adb = new ADB(opts);
		await adb.adbCommands.getAdbWithCorrectAdbPath();
		return adb;
	}
}



// // add all the methods to the ADB prototype
// for (let [fnName, fn] of _.toPairs(methods)) {
//   ADB.prototype[fnName] = fn;
// }

export default ADB;
export { DEFAULT_ADB_PORT };
