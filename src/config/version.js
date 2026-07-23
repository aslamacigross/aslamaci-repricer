const { version: APP_VERSION } = require("../../package.json");

const REQUIRED_MIGRATION = "027_packaging_profiles";

module.exports = { APP_VERSION, REQUIRED_MIGRATION };
