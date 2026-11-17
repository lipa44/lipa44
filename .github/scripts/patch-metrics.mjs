import {readFile, writeFile} from "node:fs/promises"
import {join} from "node:path"

const root = process.argv[2]
if (!root)
  throw new Error("Usage: node patch-metrics.mjs <metrics-action-directory>")
const path = join(root, "source/plugins/languages/analyzer/recent.mjs")
let source = await readFile(path, "utf8")
const original = `        commits
          .flatMap(({payload}) => payload.commits)
          .filter(({committer}) => filters.text(committer?.email, this.authoring, {debug: false}))
          .map(commit => commit.url)
          .map(async commit => (await this.rest.request(commit)).data),`
const replacement = `        (await pushCommitUrls(commits, this))
          .map(async url => (await this.rest.request(url)).data),`
if (!source.includes(original))
  throw new Error("Metrics recent analyzer changed; review the compatibility patch")
source = source.replace(original, replacement)
source = source.replace('import linguist from "linguist-js"', 'import linguist from "linguist-js"\nimport { pushCommitUrls } from "./push-commits.mjs"')
source = source.replace(
  '      .filter(({parents}) => parents.length <= 1)',
  `      .filter(({parents}) => parents.length <= 1)
      .filter(({commit, author}) => !this.authoring.length || !filters.text(commit.author?.email, this.authoring, {debug: false}) || !filters.text(commit.author?.name, this.authoring, {debug: false}) || author?.login?.toLowerCase() === this.login.toLowerCase())`,
)
await writeFile(path, source)
await writeFile(join(root, "source/plugins/languages/analyzer/push-commits.mjs"), await readFile(new URL("./push-commits.mjs", import.meta.url)))
await writeFile(join(root, "Dockerfile"), `FROM ghcr.io/lowlighter/metrics@sha256:b8013996b12be3ea049fad2e18db6b31083575a197e43ed63a690a094b9164fb
COPY source/plugins/languages/analyzer/recent.mjs /metrics/source/plugins/languages/analyzer/recent.mjs
COPY source/plugins/languages/analyzer/push-commits.mjs /metrics/source/plugins/languages/analyzer/push-commits.mjs
`)
