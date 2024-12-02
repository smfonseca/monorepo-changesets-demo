const { getReleaseLine, getDependencyReleaseLine } = require('changesets-changelog-clean');

module.exports = async function customChangelog(changeset, type) {
  const [firstLine, ...futureLines] = await getReleaseLine(changeset, type);
  const date = new Date().toISOString().split('T')[0];
  return [`${firstLine} (${date})`, ...futureLines].join('\n');
};

module.exports.getDependencyReleaseLine = getDependencyReleaseLine;
