import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const versionFile = resolve(__dirname, '..', 'client', 'src', 'lib', 'version.ts');

const now = new Date();
const date = now.toISOString().split('T')[0];
const time = now.toISOString().split('T')[1].substring(0, 5);
const buildId = `${date.replace(/-/g, '')}-${time.replace(':', '')}`;

const content = `export const APP_VERSION = "1.3.0";
export const BUILD_DATE = "${date} ${time} UTC";
export const BUILD_ID = "${buildId}";

export function getVersionString(): string {
  return \`v\${APP_VERSION} (Build: \${BUILD_DATE})\`;
}
`;

writeFileSync(versionFile, content);
console.log(`Version updated: v1.3.0 Build ${date} ${time} UTC`);
