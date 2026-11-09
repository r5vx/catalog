/**
 * The Roku app's version, as one number (major, minor, build from roku/manifest: 1.1.0 is 10100).
 * The Roku asks /api/roku/hello for it and says so when the computer's is newer: a Roku only gets
 * a new app when it's installed again from the computer (Settings → Watch on TV → Install on Roku).
 * `npm run roku` refuses to pack when this and the manifest disagree, so bump both together.
 */
export const ROKU_APP_VERSION = 10100;
