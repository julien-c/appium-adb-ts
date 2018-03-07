import log from '../logger';
import { getIMEListFromOutput, isShowingLockscreen, isCurrentFocusOnKeyguard,
				 getSurfaceOrientation, isScreenOnFully } from '../helpers';
import * as path from 'path';
import * as _ from 'lodash';
import { fs } from 'appium-support';
import * as net from 'net';
import Logcat from '../logcat';
import { sleep, retryInterval, waitForCondition } from 'asyncbox';
import { SubProcess } from 'teen_process';
import * as B from 'bluebird';
import ADB from '../adb';

const SETTINGS_HELPER_ID = 'io.appium.settings';
const WIFI_CONNECTION_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.WiFiConnectionSettingReceiver`;
const WIFI_CONNECTION_SETTING_ACTION = `${SETTINGS_HELPER_ID}.wifi`;
const DATA_CONNECTION_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.DataConnectionSettingReceiver`;
const DATA_CONNECTION_SETTING_ACTION = `${SETTINGS_HELPER_ID}.data_connection`;
const ANIMATION_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.AnimationSettingReceiver`;
const ANIMATION_SETTING_ACTION = `${SETTINGS_HELPER_ID}.animation`;
const LOCALE_SETTING_RECEIVER = `${SETTINGS_HELPER_ID}/.receivers.LocaleSettingReceiver`;
const LOCALE_SETTING_ACTION = `${SETTINGS_HELPER_ID}.locale`;
const LOCATION_SERVICE = `${SETTINGS_HELPER_ID}/.LocationService`;
const MAX_SHELL_BUFFER_LENGTH = 1000;

export class AdbCommands {
	adb: ADB;
	private _apiLevel?: number;
	constructor(adb: ADB) {
		this.adb = adb;
	}
	
	/**
	 * Get the path to adb executable amd assign it
	 * to this.executable.path and this.binaries.adb properties.
	 *
	 * @return {string} Full path to adb executable.
	 */
	async getAdbWithCorrectAdbPath() {
		this.adb.executable.path = await this.adb.systemCalls.getSdkBinaryPath("adb") as string;
		this.adb.binaries.adb = this.adb.executable.path;
		return this.adb;
	}
	
	/**
	 * Get the full path to aapt tool and assign it to
	 * this.binaries.aapt property
	 */
	async initAapt() {
		this.adb.binaries.aapt = await this.adb.systemCalls.getSdkBinaryPath("aapt") as string;
	};
	
	/**
	 * Get the full path to zipalign tool and assign it to
	 * this.binaries.zipalign property
	 */
	async initZipAlign() {
		this.adb.binaries.zipalign = await this.adb.systemCalls.getSdkBinaryPath("zipalign") as string;
	}
	
	/**
	 * Retrieve the API level of the device under test.
	 *
	 * @return {number} The API level as integer number, for example 21 for
	 *                  Android Lollipop. The result of this method is cached, so all the further
	 * calls return the same value as the first one.
	 */
	async getApiLevel() {
		if (!_.isInteger(this._apiLevel)) {
			try {
				const strOutput = await this.getDeviceProperty('ro.build.version.sdk');
				this._apiLevel = parseInt(strOutput.trim(), 10);
				if (isNaN(this._apiLevel)) {
					throw new Error(`The actual output "${strOutput}" cannot be converted to an integer`);
				}
			} catch (e) {
				log.errorAndThrow(`Error getting device API level. Original error: ${e.message}`);
			}
		}
		log.debug(`Device API level: ${this._apiLevel}`);
		return this._apiLevel;
	}
	
	/**
	 * Retrieve the platform version of the device under test.
	 *
	 * @return {string} The platform version as a string, for example '5.0' for
	 * Android Lollipop.
	 */
	async getPlatformVersion() {
		log.info("Getting device platform version");
		try {
			return await this.getDeviceProperty('ro.build.version.release');
		} catch (e) {
			log.errorAndThrow(`Error getting device platform version. Original error: ${e.message}`);
		}
	}
	
	/**
	 * Verify whether a device is connected.
	 *
	 * @return {boolean} True if at least one device is visible to adb.
	 */
	async isDeviceConnected() {
		let devices = await this.adb.systemCalls.getConnectedDevices();
		return devices.length > 0;
	}
	
	/**
	 * Recursively create a new folder on the device under test.
	 *
	 * @param {string} remotePath - The new path to be created.
	 * @return {string} mkdir command output.
	 */
	async mkdir(remotePath) {
		return await this.adb.systemCalls.shell(['mkdir', '-p', remotePath]);
	}
	
	/**
	 * Verify whether the given argument is a
	 * valid class name.
	 *
	 * @param {string} classString - The actual class name to be verified.
	 * @return {?Array.<Match>} The result of Regexp.exec operation
	 *                          or _null_ if no matches are found.
	 */
	isValidClass(classString) {
		// some.package/some.package.Activity
		return new RegExp(/^[a-zA-Z0-9\./_]+$/).exec(classString);
	}
	
	/**
	 * Force application to stop on the device under test.
	 *
	 * @param {string} pkg - The package name to be stopped.
	 * @return {string} The output of the corresponding adb command.
	 */
	async forceStop(pkg) {
		return await this.adb.systemCalls.shell(['am', 'force-stop', pkg]);
	}
	
	/**
	 * Clear the user data of the particular application on the device
	 * under test.
	 *
	 * @param {string} pkg - The package name to be cleared.
	 * @return {string} The output of the corresponding adb command.
	 */
	async clear(pkg) {
		return await this.adb.systemCalls.shell(['pm', 'clear', pkg]);
	}
	
	/**
	 * Grant all permissions requested by the particular package.
	 * This method is only useful on Android 6.0+ and for applications
	 * that support components-based permissions setting.
	 *
	 * @param {string} pkg - The package name to be processed.
	 * @param {string} apk - The path to the actual apk file.
	 * @return {string|boolean} The output of the corresponding adb command
	 *                          or _false_ if there was an error during command execution.
	 */
	async grantAllPermissions(pkg, apk) {
		let apiLevel = await this.getApiLevel();
		let targetSdk: number | null = null;
		try {
			if (!apk) {
				/**
				 * If apk not provided, considering apk already installed on the device
				 * and fetching targetSdk using package name.
				 */
				// targetSdk = await this.targetSdkVersionUsingPKG(pkg);  // todo
			} else {
				// targetSdk = await this.targetSdkVersionFromManifest(apk);  // todo
			}
		} catch (e) {
			//avoiding logging error stack, as calling library function would have logged
			log.warn(`Ran into problem getting target SDK version; ignoring...`);
		}
		if (apiLevel && apiLevel >= 23 && targetSdk && targetSdk >= 23) {
			/**
			 * If the device is running Android 6.0(API 23) or higher, and your app's target SDK is 23 or higher:
			 * The app has to list the permissions in the manifest.
			 * refer: https://developer.android.com/training/permissions/requesting.html
			 */
			const stdout = await this.adb.systemCalls.shell(['pm', 'dump', pkg]);
			const requestedPermissions = await this.getReqPermissions(pkg, stdout);
			const grantedPermissions = await this.getGrantedPermissions(pkg, stdout);
			const permissonsToGrant = requestedPermissions.filter((x) => grantedPermissions.indexOf(x) < 0);
			if (!permissonsToGrant.length) {
				log.info(`${pkg} contains no permissions available for granting.`);
				return true;
			}
			// As it consumes more time for granting each permission,
			// trying to grant all permission by forming equivalent command.
			// Also, it is necessary to split long commands into chunks, since the maximum length of
			// adb shell buffer is limited
			let cmds: string[][] = [];
			let cmdChunk: string[] = [];
			for (let permission of permissonsToGrant) {
				const nextCmd = ['pm', 'grant', pkg, permission, ';'];
				if (nextCmd.join(' ').length + cmdChunk.join(' ').length >= MAX_SHELL_BUFFER_LENGTH) {
					cmds.push(cmdChunk);
					cmdChunk = [];
				}
				cmdChunk = cmdChunk.concat(nextCmd);
			}
			if (cmdChunk.length) {
				cmds.push(cmdChunk);
			}
			log.debug(`Got the following command chunks to execute: ${cmds}`);
			let result = true;
			let lastError = null;
			for (let cmd of cmds) {
				try {
					result = await this.adb.systemCalls.shell(cmd) && result;
				} catch (e) {
					// this is to give the method a chance to assign all the requested permissions
					// before to quit in case we'd like to ignore the error on the higher level
					lastError = e;
					result = false;
				}
			}
			if (lastError) {
				throw lastError;
			}
			return result;
		}
	};

	/**
	 * Grant single permission for the particular package.
	 *
	 * @param {string} pkg - The package name to be processed.
	 * @param {string} permission - The full name of the permission to be granted.
	 * @throws {Error} If there was an error while changing permissions.
	 */
	async grantPermission(pkg, permission) {
		try {
			await this.adb.systemCalls.shell(['pm', 'grant', pkg, permission]);
		} catch (error) {
			if (!error.message.includes("not a changeable permission type")) {
				throw error;
			}
		}
	};

	/**
	 * Revoke single permission from the particular package.
	 *
	 * @param {string} pkg - The package name to be processed.
	 * @param {string} permission - The full name of the permission to be revoked.
	 * @throws {Error} If there was an error while changing permissions.
	 */
	async revokePermission(pkg, permission) {
		try {
			await this.adb.systemCalls.shell(['pm', 'revoke', pkg, permission]);
		} catch (error) {
			if (!error.message.includes("not a changeable permission type")) {
				throw error;
			}
		}
	};

	/**
	 * Retrieve the list of granted permissions for the particular package.
	 *
	 * @param {string} pkg - The package name to be processed.
	 * @param {string} cmdOutput [null] - Optional parameter containing command output of
	 *                                    _pm dump_ command. It speeds this method up
	 *                                    if present.
	 * @return {array} The list of granted permissions or an empty list.
	 * @throws {Error} If there was an error while changing permissions.
	 */
	async getGrantedPermissions(pkg, cmdOutput = null) {
		let stdout = cmdOutput || await this.adb.systemCalls.shell(['pm', 'dump', pkg]);
		let match = new RegExp(/(install permissions:|User 0)([\s\S]*?)DUMP OF SERVICE activity:/g).exec(stdout);
		if (!match) {
			throw new Error('Unable to get granted permissions');
		}
		return (match[0].match(/android\.permission\.\w+:\sgranted=true/g) || [])
			.map((x) => x.replace(/:\sgranted=true/g, ''));
	};

	/**
	 * Retrieve the list of denied permissions for the particular package.
	 *
	 * @param {string} pkg - The package name to be processed.
	 * @param {string} cmdOutput [null] - Optional parameter containing command output of
	 *                                    _pm dump_ command. It speeds this method up
	 *                                    if present.
	 * @return {array} The list of denied permissions or an empty list.
	 */
	async getDeniedPermissions(pkg, cmdOutput = null) {
		let stdout = cmdOutput || await this.adb.systemCalls.shell(['pm', 'dump', pkg]);
		let match = new RegExp(/(install permissions:|User 0)([\s\S]*?)DUMP OF SERVICE activity:/g).exec(stdout);
		if (!match) {
			throw new Error('Unable to get denied permissions');
		}
		return (match[0].match(/android\.permission\.\w+:\sgranted=false/g) || [])
			.map((x) => x.replace(/:\sgranted=false/g, ''));
	};

	/**
	 * Retrieve the list of requested permissions for the particular package.
	 *
	 * @param {string} pkg - The package name to be processed.
	 * @param {string} cmdOutput [null] - Optional parameter containing command output of
	 *                                    _pm dump_ command. It speeds this method up
	 *                                    if present.
	 * @return {array} The list of requested permissions or an empty list.
	 */
	async getReqPermissions(pkg, cmdOutput = null) {
		let stdout = cmdOutput || await this.adb.systemCalls.shell(['pm', 'dump', pkg]);
		let match = new RegExp(/requested permissions:([\s\S]*?)(install permissions:|User 0)/g).exec(stdout);
		if (!match) {
			throw new Error('Unable to get requested permissions');
		}
		return match[0].match(/android\.permission\.\w+/g) || [];
	};

	/**
	 * Retrieve the list of location providers for the device under test.
	 *
	 * @return {Array.<String>} The list of available location providers or an empty list.
	 */
	async getLocationProviders() {
		let stdout = await this.getSetting('secure', 'location_providers_allowed');
		return stdout.trim().split(',')
			.map((p) => p.trim())
			.filter(Boolean);
	};

	/**
	 * Toggle the state of GPS location provider.
	 *
	 * @param {boolean} enabled - Whether to enable (true) or disable (false) the GPS provider.
	 */
	async toggleGPSLocationProvider(enabled) {
		await this.setSetting('secure', 'location_providers_allowed', `${enabled ? "+" : "-"}gps`);
	};

	/**
	 * Stop the particular package if it is running and clears its application data.
	 *
	 * @param {string} pkg - The package name to be processed.
	 */
	stopAndClear = async function (pkg) {
		try {
			await this.forceStop(pkg);
			await this.clear(pkg);
		} catch (e) {
			log.errorAndThrow(`Cannot stop and clear ${pkg}. Original error: ${e.message}`);
		}
	}

	/**
	 * Retrieve the target SDK version for the particular package.
	 *
	 * @param {string} pkg - The package name to be processed.
	 * @return {string} The parsed SDK version.
	 */
	getTargetSdkUsingPKG = async function (pkg) {
		let stdout = await this.adb.systemCalls.shell(['pm', 'dump', pkg]);
		let targetSdk = new RegExp(/targetSdk=([^\s\s]+)/g).exec(stdout)![1];
		return targetSdk;
	}

	/**
	 * Retrieve the list of available input methods (IMEs) for the device under test.
	 *
	 * @return {Array.<String>} The list of IME names or an empty list.
	 */
	availableIMEs = async function () {
		try {
			return getIMEListFromOutput(await this.adb.systemCalls.shell(['ime', 'list', '-a']));
		} catch (e) {
			log.errorAndThrow(`Error getting available IME's. Original error: ${e.message}`);
		}
	}

	/**
	 * Retrieve the list of enabled input methods (IMEs) for the device under test.
	 *
	 * @return {Array.<String>} The list of enabled IME names or an empty list.
	 */
	enabledIMEs = async function () {
		try {
			return getIMEListFromOutput(await this.adb.systemCalls.shell(['ime', 'list']));
		} catch (e) {
			log.errorAndThrow(`Error getting enabled IME's. Original error: ${e.message}`);
		}
	}

	/**
	 * Enable the particular input method on the device under test.
	 *
	 * @param {string} imeId - One of existing IME ids.
	 */
	enableIME = async function (imeId) {
		await this.adb.systemCalls.shell(['ime', 'enable', imeId]);
	}

	/**
	 * Disable the particular input method on the device under test.
	 *
	 * @param {string} imeId - One of existing IME ids.
	 */
	disableIME = async function (imeId) {
		await this.adb.systemCalls.shell(['ime', 'disable', imeId]);
	};

	/**
	 * Set the particular input method on the device under test.
	 *
	 * @param {string} imeId - One of existing IME ids.
	 */
	setIME = async function (imeId) {
		await this.adb.systemCalls.shell(['ime', 'set', imeId]);
	};

	/**
	 * Get the default input method on the device under test.
	 *
	 * @return {string} The name of the default input method.
	 */
	defaultIME = async function () {
		try {
			let engine = await this.getSetting('secure', 'default_input_method');
			return engine.trim();
		} catch (e) {
			log.errorAndThrow(`Error getting default IME. Original error: ${e.message}`);
		}
	};

	/**
	 * Send the particular keycode to the device under test.
	 *
	 * @param {string|number} keycode - The actual key code to be sent.
	 */
	keyevent = async function (keycode) {
		// keycode must be an int.
		let code = parseInt(keycode, 10);
		await this.adb.systemCalls.shell(['input', 'keyevent', code]);
	};

	/**
	 * Send the particular text to the device under test.
	 *
	 * @param {string} text - The actual text to be sent.
	 */
	inputText = async function (text) {
		/* jshint ignore:start */
		// need to escape whitespace and ( ) < > | ; & * \ ~ " '
		text = text
						.replace(/\\/g, '\\\\')
						.replace(/\(/g, '\(')
						.replace(/\)/g, '\)')
						.replace(/</g, '\<')
						.replace(/>/g, '\>')
						.replace(/\|/g, '\|')
						.replace(/;/g, '\;')
						.replace(/&/g, '\&')
						.replace(/\*/g, '\*')
						.replace(/~/g, '\~')
						.replace(/"/g, '\"')
						.replace(/'/g, "\'")
						.replace(/ /g, '%s');
		/* jshint ignore:end */
		await this.adb.systemCalls.shell(['input', 'text', text]);
	};

	/**
	 * Clear the active text field on the device under test by sending
	 * special keyevents to it.
	 *
	 * @param {number} length [100] - The maximum length of the text in the field to be cleared.
	 */
	clearTextField = async function (length = 100) {
		// assumes that the EditText field already has focus
		log.debug(`Clearing up to ${length} characters`);
		if (length === 0) {
			return;
		}
		let args = ['input', 'keyevent'];
		for (let i = 0; i < length; i++) {
			// we cannot know where the cursor is in the text field, so delete both before
			// and after so that we get rid of everything
			// https://developer.android.com/reference/android/view/KeyEvent.html#KEYCODE_DEL
			// https://developer.android.com/reference/android/view/KeyEvent.html#KEYCODE_FORWARD_DEL
			args.push('67', '112');
		}
		await this.adb.systemCalls.shell(args);
	};

	/**
	 * Send the special keycode to the device under test in order to lock it.
	 */
	lock = async function () {
		let locked = await this.isScreenLocked();
		if (!locked) {
			log.debug("Pressing the KEYCODE_POWER button to lock screen");
			await this.keyevent(26);

			// wait for the screen to lock
			await retryInterval(10, 500, async () => {
				locked = await this.isScreenLocked();
				if (!locked) {
					log.errorAndThrow("Waiting for screen to lock.");
				}
			});
		} else {
			log.debug("Screen is already locked. Doing nothing.");
		}
	};

	/**
	 * Send the special keycode to the device under test in order to emulate
	 * Back button tap.
	 */
	back = async function () {
		log.debug("Pressing the BACK button");
		await this.keyevent(4);
	};

	/**
	 * Send the special keycode to the device under test in order to emulate
	 * Home button tap.
	 */
	async goToHome() {
		log.debug("Pressing the HOME button");
		await this.keyevent(3);
	}
	
	/**
	 * @return {string} the actual path to adb executable.
	 */
	getAdbPath() {
		return this.adb.executable.path;
	}
	
	/**
	 * Retrieve current screen orientation of the device under test.
	 *
	 * @return {number} The current orientation encoded as an integer number.
	 */
	getScreenOrientation = async function () {
		let stdout = await this.adb.systemCalls.shell(['dumpsys', 'input']);
		return getSurfaceOrientation(stdout);
	};

	/**
	 * Retrieve the screen lock state of the device under test.
	 *
	 * @return {boolean} True if the device is locked.
	 */
	isScreenLocked = async function () {
		let stdout = await this.adb.systemCalls.shell(['dumpsys', 'window']);
		if (process.env.APPIUM_LOG_DUMPSYS) {
			// optional debugging
			// if the method is not working, turn it on and send us the output
			let dumpsysFile = path.resolve(process.cwd(), "dumpsys.log");
			log.debug(`Writing dumpsys output to ${dumpsysFile}`);
			await fs.writeFile(dumpsysFile, stdout);
		}
		return (isShowingLockscreen(stdout) || isCurrentFocusOnKeyguard(stdout) ||
						!isScreenOnFully(stdout));
	};

	/**
	 * Retrieve the state of the software keyboard on the device under test.
	 *
	 * @return {boolean} True if the software keyboard is present.
	 */
	isSoftKeyboardPresent = async function () {
		try {
			let stdout = await this.adb.systemCalls.shell(['dumpsys', 'input_method']);
			let isKeyboardShown = false,
					canCloseKeyboard = false,
					inputShownMatch = /mInputShown=\w+/gi.exec(stdout);
			if (inputShownMatch && inputShownMatch[0]) {
				isKeyboardShown = inputShownMatch[0].split('=')[1] === 'true';
				let isInputViewShownMatch = /mIsInputViewShown=\w+/gi.exec(stdout);
				if (isInputViewShownMatch && isInputViewShownMatch[0]) {
					canCloseKeyboard = isInputViewShownMatch[0].split('=')[1] === 'true';
				}
			}
			return {isKeyboardShown, canCloseKeyboard};
		} catch (e) {
			log.errorAndThrow(`Error finding softkeyboard. Original error: ${e.message}`);
		}
	};

	/**
	 * Send an arbitrary Telnet command to the device under test.
	 *
	 * @param {string} command - The command to be sent.
	 *
	 * @return {string} The actual output of the given command.
	 */
	sendTelnetCommand = async function (command) {
		log.debug(`Sending telnet command to device: ${command}`);
		let port = await this.getEmulatorPort();
		return await new B((resolve, reject) => {
			let conn = net.createConnection(port, 'localhost'),
					connected = false,
					readyRegex = /^OK$/m,
					dataStream = "",
					res: string | null = null;
			conn.on('connect', () => {
				log.debug("Socket connection to device created");
			});
			conn.on('data', (dataBuf) => {
				let data = dataBuf.toString('utf8');
				if (!connected) {
					if (readyRegex.test(data)) {
						connected = true;
						log.debug("Socket connection to device ready");
						conn.write(`${command}\n`);
					}
				} else {
					dataStream += data;
					if (readyRegex.test(data)) {
						res = dataStream.replace(readyRegex, "").trim();
						res = _.last(res.trim().split('\n'))!;
						log.debug(`Telnet command got response: ${res}`);
						conn.write("quit\n");
					}
				}
			});
			conn.on('error', (err) => { // eslint-disable-line promise/prefer-await-to-callbacks
				log.debug(`Telnet command error: ${err.message}`);
				reject(err);
			});
			conn.on('close', () => {
				if (res === null) {
					reject(new Error("Never got a response from command"));
				} else {
					resolve(res);
				}
			});
		});
	};

	/**
	 * Check the state of Airplane mode on the device under test.
	 *
	 * @return {boolean} True if Airplane mode is enabled.
	 */
	isAirplaneModeOn = async function () {
		let stdout = await this.getSetting('global', 'airplane_mode_on');
		return parseInt(stdout, 10) !== 0;
	};

	/**
	 * Change the state of Airplane mode in Settings on the device under test.
	 *
	 * @param {boolean} on - True to enable the Airplane mode in Settings and false to disable it.
	 */
	setAirplaneMode = async function (on) {
		await this.setSetting('global', 'airplane_mode_on', on ? 1 : 0);
	};

	/**
	 * Broadcast the state of Airplane mode on the device under test.
	 * This method should be called after {@link #setAirplaneMode}, otherwise
	 * the mode change is not going to be applied for the device.
	 *
	 * @param {boolean} on - True to broadcast enable and false to broadcast disable.
	 */
	broadcastAirplaneMode = async function (on) {
		let args = ['am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE',
								'--ez', 'state', on ? 'true' : 'false'];
		await this.adb.systemCalls.shell(args);
	};

	/**
	 * Check the state of WiFi on the device under test.
	 *
	 * @return {boolean} True if WiFi is enabled.
	 */
	isWifiOn = async function () {
		let stdout = await this.getSetting('global', 'wifi_on');
		return (parseInt(stdout, 10) !== 0);
	};

	/**
	 * Change the state of WiFi on the device under test.
	 *
	 * @param {boolean} on - True to enable and false to disable it.
	 * @param {boolean} isEmulator [false] - Set it to true if the device under test
	 *                                       is an emulator rather than a real device.
	 */
	setWifiState = async function (on, isEmulator = false) {
		if (isEmulator) {
			await this.adb.systemCalls.shell(['svc', 'wifi', on ? 'enable' : 'disable']);
		} else {
			await this.adb.systemCalls.shell(['am', 'broadcast', '-a', WIFI_CONNECTION_SETTING_ACTION,
												'-n', WIFI_CONNECTION_SETTING_RECEIVER,
												'--es', 'setstatus', on ? 'enable' : 'disable']);
		}
	};

	/**
	 * Check the state of Data transfer on the device under test.
	 *
	 * @return {boolean} True if Data transfer is enabled.
	 */
	isDataOn = async function () {
		let stdout = await this.getSetting('global', 'mobile_data');
		return (parseInt(stdout, 10) !== 0);
	};

	/**
	 * Change the state of Data transfer on the device under test.
	 *
	 * @param {boolean} on - True to enable and false to disable it.
	 * @param {boolean} isEmulator [false] - Set it to true if the device under test
	 *                                       is an emulator rather than a real device.
	 */
	setDataState = async function (on, isEmulator = false) {
		if (isEmulator) {
			await this.adb.systemCalls.shell(['svc', 'data', on ? 'enable' : 'disable']);
		} else {
			await this.adb.systemCalls.shell(['am', 'broadcast', '-a', DATA_CONNECTION_SETTING_ACTION,
												'-n', DATA_CONNECTION_SETTING_RECEIVER,
												'--es', 'setstatus', on ? 'enable' : 'disable']);
		}
	};

	/**
	 * Change the state of WiFi and/or Data transfer on the device under test.
	 *
	 * @param {boolean} wifi - True to enable and false to disable WiFi.
	 * @param {boolean} data - True to enable and false to disable Data transfer.
	 * @param {boolean} isEmulator [false] - Set it to true if the device under test
	 *                                       is an emulator rather than a real device.
	 */
	setWifiAndData = async function ({wifi, data}, isEmulator = false) {
		if (!_.isUndefined(wifi)) {
			this.setWifiState(wifi, isEmulator);
		}
		if (!_.isUndefined(data)) {
			this.setDataState(data, isEmulator);
		}
	};

	/**
	 * Change the state of animation on the device under test.
	 * Animation on the device is controlled by the following global properties:
	 * [ANIMATOR_DURATION_SCALE]{@link https://developer.android.com/reference/android/provider/Settings.Global.html#ANIMATOR_DURATION_SCALE},
	 * [TRANSITION_ANIMATION_SCALE]{@link https://developer.android.com/reference/android/provider/Settings.Global.html#TRANSITION_ANIMATION_SCALE},
	 * [WINDOW_ANIMATION_SCALE]{@link https://developer.android.com/reference/android/provider/Settings.Global.html#WINDOW_ANIMATION_SCALE}.
	 * This method sets all this properties to 0.0 to disable (1.0 to enable) animation.
	 *
	 * Turning off animation might be useful to improve stability
	 * and reduce tests execution time.
	 *
	 * @param {boolean} on - True to enable and false to disable it.
	 */
	setAnimationState = async function (on) {
		await this.adb.systemCalls.shell(['am', 'broadcast', '-a', ANIMATION_SETTING_ACTION,
											'-n', ANIMATION_SETTING_RECEIVER,
											'--es', 'setstatus', on ? 'enable' : 'disable']);
	};

	/**
	 * Check the state of animation on the device under test.
	 *
	 * @return {boolean} True if at least one of animation scale settings
	 *                   is not equal to '0.0'.
	 */
	isAnimationOn = async function () {
		let animator_duration_scale = await this.getSetting('global', 'animator_duration_scale');
		let transition_animation_scale = await this.getSetting('global', 'transition_animation_scale');
		let window_animation_scale = await this.getSetting('global', 'window_animation_scale');
		return _.some([animator_duration_scale, transition_animation_scale, window_animation_scale],
									(setting) => setting !== '0.0');
	};

	/**
	 * Change the locale on the device under test. Don't need to reboot the device after changing the locale.
	 * This method sets an arbitrary locale following:
	 *   https://developer.android.com/reference/java/util/Locale.html
	 *   https://developer.android.com/reference/java/util/Locale.html#Locale(java.lang.String,%20java.lang.String)
	 *
	 * @param {string} language - Language. e.g. en, ja
	 * @param {string} country - Country. e.g. US, JP
	 */
	setDeviceSysLocaleViaSettingApp = async function (language, country) {
		await this.adb.systemCalls.shell(['am', 'broadcast', '-a', LOCALE_SETTING_ACTION,
			'-n', LOCALE_SETTING_RECEIVER,
			'--es', 'lang', language.toLowerCase(),
			'--es', 'country', country.toUpperCase()]);
	};

	/**
	 * @typedef {Object} Location
	 * @property {float|string} longitude - Valid longitude value.
	 * @property {float|string} latitude - Valid latitude value.
	 */

	/**
	 * Emulate geolocation coordinates on the device under test.
	 *
	 * @param {Location} location - Location object.
	 * @param {boolean} isEmulator [false] - Set it to true if the device under test
	 *                                       is an emulator rather than a real device.
	 */
	setGeoLocation = async function (location, isEmulator = false) {
		let longitude: any = parseFloat(location.longitude);
		if (isNaN(longitude)) {
			log.errorAndThrow(`location.longitude is expected to be a valid float number. '${location.longitude}' is given instead`);
		}
		longitude = `${_.ceil(longitude, 5)}`;
		let latitude: any = parseFloat(location.latitude);
		if (isNaN(latitude)) {
			log.errorAndThrow(`location.latitude is expected to be a valid float number. '${location.latitude}' is given instead`);
		}
		latitude = `${_.ceil(latitude, 5)}`;
		if (isEmulator) {
			await this.resetTelnetAuthToken();
			await this.adbExec(['emu', 'geo', 'fix', longitude, latitude]);
			// A workaround for https://code.google.com/p/android/issues/detail?id=206180
			await this.adbExec(['emu', 'geo', 'fix', longitude.replace('.', ','), latitude.replace('.', ',')]);
		} else {
			return await this.adb.systemCalls.shell(['am', 'startservice', '-e', 'longitude', longitude,
															'-e', 'latitude', latitude, LOCATION_SERVICE]);
		}
	};

	/**
	 * Forcefully recursively remove a path on the device under test.
	 * Be careful while calling this method.
	 *
	 * @param {string} path - The path to be removed recursively.
	 */
	rimraf = async function (path) {
		await this.adb.systemCalls.shell(['rm', '-rf', path]);
	};

	/**
	 * Send a file to the device under test.
	 *
	 * @param {string} localPath - The path to the file on the local file system.
	 * @param {string} remotePath - The destination path on the remote device.
	 * @param {object} opts - Additional options mapping. See
	 *                        https://github.com/appium/node-teen_process,
	 *                        _exec_ method options, for more information about available
	 *                        options.
	 */
	push = async function (localPath, remotePath, opts) {
		await this.adbExec(['push', localPath, remotePath], opts);
	};

	/**
	 * Receive a file from the device under test.
	 *
	 * @param {string} remotePath - The source path on the remote device.
	 * @param {string} localPath - The destination path to the file on the local file system.
	 */
	pull = async function (remotePath, localPath) {
		// pull folder can take more time, increasing time out to 60 secs
		await this.adbExec(['pull', remotePath, localPath], {timeout: 60000});
	};

	/**
	 * Check whether the process with the particular name is running on the device
	 * under test.
	 *
	 * @param {string} processName - The name of the process to be checked.
	 * @return {boolean} True if the given process is running.
	 * @throws {error} If the given process name is not a valid class name.
	 */
	processExists = async function (processName) {
		try {
			if (!this.isValidClass(processName)) {
				throw new Error(`Invalid process name: ${processName}`);
			}
			let stdout = await this.adb.systemCalls.shell("ps");
			for (let line of stdout.split(/\r?\n/)) {
				line = line.trim().split(/\s+/);
				let pkgColumn = line[line.length - 1];
				if (pkgColumn && pkgColumn.indexOf(processName) !== -1) {
					return true;
				}
			}
			return false;
		} catch (e) {
			log.errorAndThrow(`Error finding if process exists. Original error: ${e.message}`);
		}
	};

	/**
	 * Get TCP port forwarding with adb on the device under test.
	 * @return {Array.<String>} The output of the corresponding adb command. An array contains each forwarding line of output
	 */
	getForwardList = async function () {
		log.debug(`List forwarding ports`);
		let connections = await this.adbExec(['forward', '--list']);
		return connections.split('\n');
	};

	/**
	 * Setup TCP port forwarding with adb on the device under test.
	 *
	 * @param {string|number} systemPort - The number of the local system port.
	 * @param {string|number} devicePort - The number of the remote device port.
	 */
	forwardPort = async function (systemPort, devicePort) {
		log.debug(`Forwarding system: ${systemPort} to device: ${devicePort}`);
		await this.adbExec(['forward', `tcp:${systemPort}`, `tcp:${devicePort}`]);
	};

	/**
	 * Remove TCP port forwarding with adb on the device under test. The forwarding
	 * for the given port should be setup with {@link #forwardPort} first.
	 *
	 * @param {string|number} systemPort - The number of the local system port
	 *                                     to remove forwarding on.
	 */
	removePortForward = async function (systemPort) {
		log.debug(`Removing forwarded port socket connection: ${systemPort} `);
		await this.adbExec(['forward', `--remove`, `tcp:${systemPort}`]);
	};

	/**
	 * Setup TCP port forwarding with adb on the device under test. The difference
	 * between {@link #forwardPort} is that this method does setup for an abstract
	 * local port.
	 *
	 * @param {string|number} systemPort - The number of the local system port.
	 * @param {string|number} devicePort - The number of the remote device port.
	 */
	forwardAbstractPort = async function (systemPort, devicePort) {
		log.debug(`Forwarding system: ${systemPort} to abstract device: ${devicePort}`);
		await this.adbExec(['forward', `tcp:${systemPort}`, `localabstract:${devicePort}`]);
	};

	/**
	 * Execute ping shell command on the device under test.
	 *
	 * @return {boolean} True if the command output contains 'ping' substring.
	 * @throws {error} If there was an error while executing 'ping' command on the
	 *                 device under test.
	 */
	ping = async function () {
		let stdout = await this.adb.systemCalls.shell(["echo", "ping"]);
		if (stdout.indexOf("ping") === 0) {
			return true;
		}
		throw new Error(`ADB ping failed, returned ${stdout}`);
	};

	/**
	 * Restart the device under test using adb commands.
	 *
	 * @throws {error} If start fails.
	 */
	restart = async function () {
		try {
			await this.stopLogcat();
			await this.restartAdb();
			await this.waitForDevice(60);
			await this.startLogcat();
		} catch (e) {
			log.errorAndThrow(`Restart failed. Orginial error: ${e.message}`);
		}
	};

	/**
	 * Start the logcat process to gather logs.
	 *
	 * @throws {error} If restart fails.
	 */
	startLogcat = async function () {
		if (this.logcat !== null) {
			log.errorAndThrow("Trying to start logcat capture but it's already started!");
		}
		this.logcat = new Logcat({
			adb: this.executable,
			debug: false,
			debugTrace: false,
			clearDeviceLogsOnStart: !!this.clearDeviceLogsOnStart,
		});
		await this.logcat.startCapture();
	};

	/**
	 * Stop the active logcat process which gathers logs.
	 * The call will be ignored if no logcat process is running.
	 */
	stopLogcat = async function () {
		if (this.logcat !== null) {
			await this.logcat.stopCapture();
			this.logcat = null;
		}
	};

	/**
	 * Retrieve the output from the currently running logcat process.
	 * The logcat process should be executed by {2link #startLogcat} method.
	 *
	 * @return {string} The collected logcat output.
	 * @throws {error} If logcat process is not running.
	 */
	getLogcatLogs = function () {
		if (this.logcat === null) {
			log.errorAndThrow("Can't get logcat logs since logcat hasn't started");
		}
		return this.logcat.getLogs();
	};

	/**
	 * Get the list of process ids for the particular process on the device under test.
	 *
	 * @param {string} name - The part of process name.
	 * @return {Array.<number>} The list of matched process IDs or an empty list.
	 */
	async getPIDsByName(name: string) {
		log.debug(`Getting all processes with ${name}`);
		try {
			// ps <comm> where comm is last 15 characters of package name
			if (name.length > 15) {
				name = name.substr(name.length - 15);
			}
			let stdout = (await this.adb.systemCalls.shell(["ps"])).trim();
			let pids: number[] = [];
			for (let line of stdout.split("\n")) {
				if (line.indexOf(name) !== -1) {
					let match = /[^\t ]+[\t ]+([0-9]+)/.exec(line);
					if (match) {
						pids.push(parseInt(match[1], 10));
					} else {
						throw new Error(`Could not extract PID from ps output: ${line}`);
					}
				}
			}
			return pids;
		} catch (e) {
			log.errorAndThrow(`Unable to get pids for ${name}. Orginial error: ${e.message}`);
		}
	}
	
	/**
	 * Get the list of process ids for the particular process on the device under test.
	 *
	 * @param {string} name - The part of process name.
	 * @return {Array.<number>} The list of matched process IDs or an empty list.
	 */
	killProcessesByName = async function (name) {
		try {
			log.debug(`Attempting to kill all ${name} processes`);
			let pids = await this.getPIDsByName(name);
			if (pids.length < 1) {
				log.info(`No ${name} process found to kill, continuing...`);
				return;
			}
			for (let pid of pids) {
				await this.killProcessByPID(pid);
			}
		} catch (e) {
			log.errorAndThrow(`Unable to kill ${name} processes. Original error: ${e.message}`);
		}
	};

	/**
	 * Kill the particular process on the device under test.
	 *
	 * @param {string|number} pid - The ID of the process to be killed.
	 * @return {string} Kill command stdout.
	 * @throws {Error} If the process with given ID is not present or cannot be killed.
	 */
	killProcessByPID = async function (pid) {
		log.debug(`Attempting to kill process ${pid}`);
		// Just to check if the process exists and throw an exception otherwise
		await this.adb.systemCalls.shell(['kill', '-0', pid]);
		const timeoutMs = 1000;
		let stdout;
		try {
			await waitForCondition(async () => {
				try {
					stdout = await this.adb.systemCalls.shell(['kill', pid]);
					return false;
				} catch (e) {
					// kill returns non-zero code if the process is already killed
					return true;
				}
			}, {waitMs: timeoutMs, intervalMs: 300});
		} catch (err) {
			log.warn(`Cannot kill process ${pid} in ${timeoutMs} ms. Trying to force kill...`);
			stdout = await this.adb.systemCalls.shell(['kill', '-9', pid]);
		}
		return stdout;
	};

	/**
	 * Broadcast process killing on the device under test.
	 *
	 * @param {string} intent - The name of the intent to broadcast to.
	 * @param {string} processName - The name of the killed process.
	 * @throws {error} If the process was not killed.
	 */
	broadcastProcessEnd = async function (intent, processName) {
		// start the broadcast without waiting for it to finish.
		this.broadcast(intent);
		// wait for the process to end
		let start = Date.now();
		let timeoutMs = 40000;
		try {
			while ((Date.now() - start) < timeoutMs) {
				if (await this.processExists(processName)) {
					// cool down
					await sleep(400);
					continue;
				}
				return;
			}
			throw new Error(`Process never died within ${timeoutMs} ms`);
		} catch (e) {
			log.errorAndThrow(`Unable to broadcast process end. Original error: ${e.message}`);
		}
	};

	/**
	 * Broadcast a message to the given intent.
	 *
	 * @param {string} intent - The name of the intent to broadcast to.
	 * @throws {error} If intent name is not a valid class name.
	 */
	broadcast = async function (intent) {
		if (!this.isValidClass(intent)) {
			log.errorAndThrow(`Invalid intent ${intent}`);
		}
		log.debug(`Broadcasting: ${intent}`);
		await this.adb.systemCalls.shell(['am', 'broadcast', '-a', intent]);
	};

	/**
	 * Kill Android instruments if they are currently running.
	 */
	endAndroidCoverage = async function () {
		if (this.instrumentProc && this.instrumentProc.isRunning) {
			await this.instrumentProc.stop();
		}
	};

	/**
	 * Instrument the particular activity.
	 *
	 * @param {string} pkg - The name of the package to be instrumented.
	 * @param {string} activity - The name of the main activity in this package.
	 * @param {string} instrumentWith - The name of the package to instrument
	 *                                  the activity with.
	 * @throws {error} If any exception is reported by adb shell.
	 */
	instrument = async function (pkg, activity, instrumentWith) {
		if (activity[0] !== ".") {
			pkg = "";
		}
		let pkgActivity = (pkg + activity).replace(/\.+/g, '.'); // Fix pkg..activity error
		let stdout = await this.adb.systemCalls.shell(['am', 'instrument', '-e', 'main_activity',
																	pkgActivity, instrumentWith]);
		if (stdout.indexOf("Exception") !== -1) {
			log.errorAndThrow(`Unknown exception during instrumentation. ` +
												`Original error ${stdout.split("\n")[0]}`);
		}
	};

	/**
	 * Collect Android coverage by instrumenting the particular activity.
	 *
	 * @param {string} instrumentClass - The name of the instrumentation class.
	 * @param {string} waitPkg - The name of the package to be instrumented.
	 * @param {string} waitActivity - The name of the main activity in this package.
	 *
	 * @return {promise} The promise is successfully resolved if the instrumentation starts
	 *                   without errors.
	 */
	androidCoverage = async function (instrumentClass, waitPkg, waitActivity) {
		if (!this.isValidClass(instrumentClass)) {
			log.errorAndThrow(`Invalid class ${instrumentClass}`);
		}
		return await new B(async (resolve, reject) => {
			let args = this.executable.defaultArgs
				.concat(['shell', 'am', 'instrument', '-e', 'coverage', 'true', '-w'])
				.concat([instrumentClass]);
			log.debug(`Collecting coverage data with: ${[this.executable.path].concat(args).join(' ')}`);
			try {
				// am instrument runs for the life of the app process.
				this.instrumentProc = new SubProcess(this.executable.path, args);
				await this.instrumentProc.start(0);
				this.instrumentProc.on('output', (stdout, stderr) => {
					if (stderr) {
						reject(new Error(`Failed to run instrumentation. Original error: ${stderr}`));
					}
				});
				await this.waitForActivity(waitPkg, waitActivity);
				resolve();
			} catch (e) {
				reject(new Error(`Android coverage failed. Original error: ${e.message}`));
			}
		});
	};

	/**
	 * Get the particular property of the device under test.
	 *
	 * @param {string} property - The name of the property. This name should
	 *                            be known to _adb shell getprop_ tool.
	 *
	 * @return {string} The value of the given property.
	 */
	async getDeviceProperty(property) {
		let stdout = await this.adb.systemCalls.shell(['getprop', property]);
		let val = stdout.trim();
		log.debug(`Current device property '${property}': ${val}`);
		return val;
	};

	/**
	 * Set the particular property of the device under test.
	 *
	 * @param {string} property - The name of the property. This name should
	 *                            be known to _adb shell setprop_ tool.
	 * @param {string} val - The new property value.
	 *
	 * @throws {error} If _setprop_ utility fails to change property value.
	 */
	setDeviceProperty = async function (prop, val) {
		let apiLevel = await this.getApiLevel();
		if (apiLevel >= 26) {
			log.debug(`Running adb root, Android O needs adb to be rooted to setDeviceProperty`);
			await this.root();
		}
		log.debug(`Setting device property '${prop}' to '${val}'`);
		let err;
		try {
			await this.adb.systemCalls.shell(['setprop', prop, val]);
		} catch (e) {
			err = e;
		}
		if (apiLevel >= 26) {
			log.debug(`Removing adb root for setDeviceProperty`);
			await this.unroot();
		}
		if (err) throw err; // eslint-disable-line curly
	};

	/**
	 * @return {string} Current system language on the device under test.
	 */
	getDeviceSysLanguage = async function () {
		return await this.getDeviceProperty("persist.sys.language");
	};

	/**
	 * Set the new system language on the device under test.
	 *
	 * @param {string} language - The new language value.
	 */
	setDeviceSysLanguage = async function (language) {
		return await this.setDeviceProperty("persist.sys.language", language.toLowerCase());
	};

	/**
	 * @return {string} Current country name on the device under test.
	 */
	getDeviceSysCountry = async function () {
		return await this.getDeviceProperty("persist.sys.country");
	};

	/**
	 * Set the new system country on the device under test.
	 *
	 * @param {string} country - The new country value.
	 */
	setDeviceSysCountry = async function (country) {
		return await this.setDeviceProperty("persist.sys.country", country.toUpperCase());
	};

	/**
	 * @return {string} Current system locale name on the device under test.
	 */
	getDeviceSysLocale = async function () {
		return await this.getDeviceProperty("persist.sys.locale");
	};

	/**
	 * Set the new system locale on the device under test.
	 *
	 * @param {string} locale - The new locale value.
	 */
	setDeviceSysLocale = async function (locale) {
		return await this.setDeviceProperty("persist.sys.locale", locale);
	};

	/**
	 * @return {string} Current product language name on the device under test.
	 */
	getDeviceProductLanguage = async function () {
		return await this.getDeviceProperty("ro.product.locale.language");
	};

	/**
	 * @return {string} Current product country name on the device under test.
	 */
	getDeviceProductCountry = async function () {
		return await this.getDeviceProperty("ro.product.locale.region");
	};

	/**
	 * @return {string} Current product locale name on the device under test.
	 */
	getDeviceProductLocale = async function () {
		return await this.getDeviceProperty("ro.product.locale");
	};

	/**
	 * @return {string} The model name of the device under test.
	 */
	getModel = async function () {
		return await this.getDeviceProperty("ro.product.model");
	};

	/**
	 * @return {string} The manufacturer name of the device under test.
	 */
	getManufacturer = async function () {
		return await this.getDeviceProperty("ro.product.manufacturer");
	};

	/**
	 * Get the current screen size.
	 *
	 * @return {string} Device screen size as string in format 'WxH' or
	 *                  _null_ if it cannot be determined.
	 */
	getScreenSize = async function () {
		let stdout = await this.adb.systemCalls.shell(['wm', 'size']);
		let size = new RegExp(/Physical size: ([^\r?\n]+)*/g).exec(stdout);
		if (size && size.length >= 2) {
			return size[1].trim();
		}
		return null;
	};

	/**
	 * Get the current screen density in dpi
	 *
	 * @return {?number} Device screen density as a number or _null_ if it
	 *                  cannot be determined
	 */
	getScreenDensity = async function () {
		let stdout = await this.adb.systemCalls.shell(['wm', 'density']);
		let density = new RegExp(/Physical density: ([^\r?\n]+)*/g).exec(stdout);
		if (density && density.length >= 2) {
			let densityNumber = parseInt(density[1].trim(), 10);
			return isNaN(densityNumber) ? null : densityNumber;
		}
		return null;
	};

	/**
	 * Setup HTTP proxy in device settings.
	 *
	 * @param {string} proxyHost - The host name of the proxy.
	 * @param {string|number} proxyPort - The port number to be set.
	 */
	setHttpProxy = async function (proxyHost, proxyPort) {
		let proxy = `${proxyHost}:${proxyPort}`;
		if (_.isUndefined(proxyHost)) {
			log.errorAndThrow(`Call to setHttpProxy method with undefined proxy_host: ${proxy}`);
		}
		if (_.isUndefined(proxyPort)) {
			log.errorAndThrow(`Call to setHttpProxy method with undefined proxy_port ${proxy}`);
		}
		await this.setSetting('global', 'http_proxy', proxy);
		await this.setSetting('secure', 'http_proxy', proxy);
		await this.setSetting('system', 'http_proxy', proxy);
		await this.setSetting('system', 'global_http_proxy_host', proxyHost);
		await this.setSetting('system', 'global_http_proxy_port', proxyPort);
	};

	/**
	 * Set device property.
	 * [android.provider.Settings]{@link https://developer.android.com/reference/android/provider/Settings.html}
	 *
	 * @param {string} namespace - one of {system, secure, global}, case-insensitive.
	 * @param {string} setting - property name.
	 * @param {string|number} value - property value.
	 * @return {string} command output.
	 */
	setSetting = async function (namespace, setting, value) {
		return await this.adb.systemCalls.shell(['settings', 'put', namespace, setting, value]);
	};

	/**
	 * Get device property.
	 * [android.provider.Settings]{@link https://developer.android.com/reference/android/provider/Settings.html}
	 *
	 * @param {string} namespace - one of {system, secure, global}, case-insensitive.
	 * @param {string} setting - property name.
	 * @return {string} property value.
	 */
	getSetting = async function (namespace, setting) {
		return await this.adb.systemCalls.shell(['settings', 'get', namespace, setting]);
	};

	/**
	 * Retrieve the `adb bugreport` command output. This
	 * operation may take up to several minutes.
	 *
	 * @param {?number} timeout [120000] - Command timeout in milliseconds
	 * @returns {string} Command stdout
	 */
	async bugreport(timeout = 120000) {
		return await this.adb.systemCalls.adbExec(['bugreport'], {timeout});
	}
}


