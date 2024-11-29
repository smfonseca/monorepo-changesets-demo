import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Octokit } from '@octokit/rest';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const NPM_TOKEN = process.env.NPM_TOKEN;
// const REPO_OWNER = process.env.GITHUB_REPOSITORY.split('/')[0];
// const REPO_NAME = process.env.GITHUB_REPOSITORY.split('/')[1];

const octokit = new Octokit({ auth: GITHUB_TOKEN });

async function main() {
  try {
    console.log('Generating Changeset status...');
    execSync('pnpm changeset status --output scripts/changeset-status.json', { stdio: 'inherit' });

    if (!fs.existsSync('changeset-status.json')) {
      console.log('No changeset-status.json found. Exiting.');
      return;
    }

    const status = JSON.parse(fs.readFileSync('changeset-status.json', 'utf-8'));
    if (status.releases.length === 0) {
      console.log('No packages to release. Skipping further steps.');
      return;
    }

    console.log('Applying Changesets...');
    execSync('pnpm changeset version', { stdio: 'inherit' });

    console.log('Extracting updated package names and versions...');
    const updatedPackages = [];
    const updatedVersions = [];

    const changedFiles = execSync('git diff --name-only', { encoding: 'utf-8' })
    .split('\n')
    .filter((file) => file.includes('package.json'));

    changedFiles.forEach((file) => {
      const packageJsonPath = path.resolve(file);
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      if (packageJson.name) {
        updatedPackages.push(packageJson.name);
      }

      if (packageJson.version) {
        updatedVersions.push(packageJson.version);
      }
    });

    const packagesWithVersions = updatedPackages.map((name, index) => `${name}: ${updatedVersions[index]}`).join(', ');

    console.log('Committing changes...');
    execSync('git config user.name "github-actions[bot]"');
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');

    const commitMessage = packagesWithVersions
      ? `chore(release): ${packagesWithVersions} [skip ci]`
      : 'chore(release): applied changesets [skip ci]';

    execSync('git add .');
    execSync(`git commit -m "${commitMessage}" || echo "No changes to commit"`, { stdio: 'inherit' });

    console.log('Pushing changes to main...');
    execSync('git push origin main', { stdio: 'inherit' });

    console.log('Publishing to NPM...');
    execSync(`pnpm config set '//registry.npmjs.org/:_authToken' "${NPM_TOKEN}"`, { stdio: 'inherit' });
    execSync('pnpm changeset publish -r', { stdio: 'inherit' });

    console.log('Pushing tags...');
    execSync('git push --tags', { stdio: 'inherit' });

    console.log('Generating Release Notes...');
    const updatedChangelogs = execSync('git diff --name-only HEAD~1 HEAD | grep CHANGELOG.md || true', {
      encoding: 'utf-8',
    }).trim();

    if (!updatedChangelogs) {
      console.log('No updated changelogs found. Skipping release notes creation.');
      return;
    }

    const releaseNotesByPackage = [];
    updatedChangelogs.split('\n').forEach((changelogPath) => {
      const packageName = path.basename(path.dirname(changelogPath));
      const changelogContent = fs.readFileSync(changelogPath, 'utf-8');
      const latestEntry = changelogContent.split('## ')[1]?.split('## ')[0]?.trim();

      if (latestEntry) {
        releaseNotesByPackage.push({
          packageName,
          notes: latestEntry,
        });
      }
    });

    console.log('Creating GitHub Releases...');
    const tags = execSync('git tag --points-at HEAD', { encoding: 'utf-8' }).trim().split('\n');
    for (const tag of tags) {
      const packageName = updatedPackages.find((name) => tag.includes(name)) || tag;
      const releaseNotes = releaseNotesByPackage.find((pkg) => pkg.packageName === packageName)?.notes;

      if (!releaseNotes) {
        console.log(`No release notes found for ${packageName}. Skipping.`);
        continue;
      }

      console.log(`Creating release for ${tag} with notes:`);
      console.log(releaseNotes);

      await octokit.rest.repos.createRelease({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        tag_name: tag,
        name: tag,
        body: releaseNotes,
      });
    }

    console.log('All done!');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
