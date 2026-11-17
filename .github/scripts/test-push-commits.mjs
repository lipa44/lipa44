import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {join} from "node:path"
import test from "node:test"
import {pushCommitUrls} from "./push-commits.mjs"

const event = (payload = {before: "base", head: "head"}) => ({type: "PushEvent", repo: {name: "lipa44/project"}, payload, actor: {login: "lipa44"}, created_at: new Date().toISOString()})

test("modern pushes resolve every compare page and deduplicate commit URLs", async () => {
  const calls = []
  const urls = await pushCommitUrls([event(), event(), event({before: "head", head: "next"})], {
    rest: {request: async (route, params) => {
      calls.push({route, ...params})
      return params.basehead === "base...head" && params.page === 1
        ? {data: {commits: [{url: "commit/1"}]}, headers: {link: '<next>; rel="next"'}}
        : {data: {commits: [{url: "commit/1"}, {url: "commit/2"}]}, headers: {}}
    }},
  })
  assert.deepEqual(urls, ["commit/1", "commit/2"])
  assert.equal(calls.length, 3)
  assert.equal(calls[1].page, 2)
  assert.equal(calls[0].basehead, "base...head")
})

test("new branches use a bounded commit history; deleted refs are ignored", async () => {
  const calls = []
  const urls = await pushCommitUrls([event({before: "0".repeat(40), head: "head"}), event({before: "base", head: "0".repeat(40)})], {
    days: 14,
    rest: {request: async (route, params) => {
      calls.push({route, ...params})
      return {data: [{url: "commit/new"}], headers: {}}
    }},
  })
  assert.deepEqual(urls, ["commit/new"])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].route, "GET /repos/{owner}/{repo}/commits")
  assert.equal(calls[0].sha, "head")
  assert.ok(Math.abs(Date.parse(calls[0].since) - (Date.now() - 14 * 86400000)) < 1000)
})

test("legacy events retain commits and tolerate missing entries", async () => {
  assert.deepEqual(await pushCommitUrls([event({commits: [null, {url: "commit/old"}]})], {}), ["commit/old"])
})

test("REST errors fail visibly instead of producing empty statistics", async () => {
  await assert.rejects(pushCommitUrls([event()], {rest: {request: async () => {throw new Error("403 Forbidden")}}}), /403 Forbidden/)
})

test("actual recent analyzer handles current PushEvents and filters authors after fetching commits", async () => {
  const root = process.env.METRICS_ACTION_PATH
  assert.ok(root, "METRICS_ACTION_PATH must point to the checked-out Metrics source")
  const source = (await readFile(join(root, "source/plugins/languages/analyzer/recent.mjs"), "utf8"))
    .replace(/^import .*\n/gm, "").replace("export class", "class")
  const filters = {text: (text, patterns) => !patterns.includes(String(text).toLowerCase())}
  const RecentAnalyzer = new Function("Analyzer", "filters", "pushCommitUrls", `${source}\nreturn RecentAnalyzer`)(class {}, filters, pushCommitUrls)
  const analyzer = Object.create(RecentAnalyzer.prototype)
  const detail = (sha, email) => ({
    sha, parents: [{}], author: {login: email === "me@example.com" ? "lipa44" : "other"},
    commit: {message: sha, author: {name: "Author", email}, committer: {name: "GitHub", date: "2026-11-17"}},
    files: [{filename: "example.cs", patch: "+hello"}],
  })
  Object.assign(analyzer, {
    days: 14, load: 100, context: {}, account: "user", login: "lipa44", authoring: ["me@example.com"],
    results: {}, markers: {line: /^(?<op>[-+])\s*(?<content>[\s\S]+)$/}, debug() {}, ignore: () => false,
    rest: {
      activity: {listEventsForAuthenticatedUser: async () => ({data: [event()]})},
      request: async (route) => route.startsWith("GET ")
        ? {data: {commits: [{url: "mine"}, {url: "other"}]}, headers: {}}
        : {data: detail(route, route === "mine" ? "me@example.com" : "someone@example.com")},
    },
  })
  const patches = await analyzer.patches()
  assert.deepEqual(patches.map(({sha}) => sha), ["mine"])
  assert.equal(patches[0].editions[0].added.bytes, 5)
})
