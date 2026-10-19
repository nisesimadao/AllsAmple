// No upload happens here. The dist:release scripts use --publish never; publishing
// the concrete artifacts is a separate action for the chosen distribution host.
module.exports = require('./build/release-config.cjs')();
