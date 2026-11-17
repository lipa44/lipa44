// Resolve push commits through REST because Events API no longer embeds them.
export async function pushCommitUrls(events, analyzer) {
  const urls = new Set()
  const pushes = new Set()
  for (const {repo: {name}, payload} of events) {
    if (Array.isArray(payload.commits)) {
      for (const commit of payload.commits)
        if (commit?.url)
          urls.add(commit.url)
      continue
    }
    const {before, head} = payload
    if (!head || /^0+$/.test(head))
      continue
    const key = `${name}:${before}:${head}`
    if (pushes.has(key))
      continue
    pushes.add(key)
    const [owner, repo] = name.split("/")
    const compare = before && !/^0+$/.test(before)
    const route = compare
      ? "GET /repos/{owner}/{repo}/compare/{basehead}"
      : "GET /repos/{owner}/{repo}/commits"
    const params = compare
      ? {owner, repo, basehead: `${before}...${head}`}
      : {owner, repo, sha: head, ...(analyzer.days ? {since: new Date(Date.now() - analyzer.days * 86400000).toISOString()} : {})}
    for (let page = 1; ; page++) {
      const {data, headers} = await analyzer.rest.request(route, {...params, per_page: 100, page})
      for (const commit of compare ? data.commits : data)
        if (commit?.url)
          urls.add(commit.url)
      if (!headers?.link?.includes('rel="next"'))
        break
    }
  }
  return [...urls]
}
