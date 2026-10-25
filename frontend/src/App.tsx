
import { useState } from "react";
import "./App.css";

type Issue = {
  title: string;
  description: string;
  labels: string[];
  number: number;
  url: string;
};

type Page = "dashboard" | "issues" | "planner" | "pr" | "analyzer" | "guide";

type PlanResponse = {
  success?: boolean;
  plan?: string;
  error?: string;
};

function App() {
  const [activePage, setActivePage] = useState<Page>("dashboard");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return localStorage.getItem("osm-theme") === "light" ? "light" : "dark"; }
    catch { return "dark"; }
  });
  const [toolLoading, setToolLoading] = useState(false);
  const [toolError, setToolError] = useState("");
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [guideResult, setGuideResult] = useState<any>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [repoName, setRepoName] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [planIssueNumber, setPlanIssueNumber] = useState<number | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [contributionPlan, setContributionPlan] = useState("");
  const [planError, setPlanError] = useState("");
  const [showBeginnerOnly, setShowBeginnerOnly] = useState(false);
  const [selectedIssueNumber, setSelectedIssueNumber] = useState("");
  const [prTitle, setPrTitle] = useState("");
  const [prDescription, setPrDescription] = useState("");

  const beginnerIssues = issues.filter((issue) =>
    issue.labels.some((label) =>
      ["good first issue", "beginner", "help wanted"].includes(
        label.toLowerCase()
      )
    )
  );

  const visibleIssues = showBeginnerOnly ? beginnerIssues : issues;

  const selectedIssue =
    issues.find((issue) => issue.number === Number(selectedIssueNumber)) ??
    null;

  async function findIssues() {
    const match = repoUrl.trim().match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?$/
    );

    if (!match) {
      setMessage("Enter a valid URL, such as https://github.com/vitejs/vite");
      return;
    }

    const owner = match[1];
    const repo = match[2].replace(/\.git$/, "");

    setLoading(true);
    setMessage("");
    setIssues([]);
    setRepoName(`${owner}/${repo}`);
    setShowBeginnerOnly(false);
    setPlanIssueNumber(null);
    setContributionPlan("");
    setPlanError("");
    setSelectedIssueNumber("");
    setPrTitle("");
    setPrDescription("");

    try {
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=open&per_page=10`,
        {
          headers: {
            Accept: "application/vnd.github+json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? "Repository not found or not publicly accessible."
            : response.status === 403
              ? "GitHub API rate limit reached. Wait and try again."
              : `GitHub API returned status ${response.status}.`
        );
      }

      const data: unknown = await response.json();

      if (!Array.isArray(data)) {
        throw new Error("GitHub returned an unexpected response.");
      }

      const actualIssues: Issue[] = data
        .filter(
          (item: { pull_request?: unknown }) => !item.pull_request
        )
        .map(
          (item: {
            title: string;
            body: string | null;
            labels: { name: string }[];
            number: number;
            html_url: string;
          }) => ({
            title: item.title,
            description: item.body || "No description provided.",
            labels: item.labels.map((label) => label.name),
            number: item.number,
            url: item.html_url,
          })
        );

      setIssues(actualIssues);
      setMessage(
        actualIssues.length
          ? `Found ${actualIssues.length} open issues from GitHub.`
          : "No open issues were found in this result."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not retrieve GitHub issues. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function changeTheme(nextTheme: "dark" | "light") {
    setTheme(nextTheme);
    try { localStorage.setItem("osm-theme", nextTheme); } catch { /* storage may be disabled */ }
  }

  async function runRepositoryTool(tool: "analyzer" | "guide") {
    const match = repoUrl.trim().match(/^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/#?]+)\/?$/i);
    if (!match) {
      setToolError("Enter a valid public GitHub URL, for example https://github.com/facebook/react.");
      return;
    }
    setToolLoading(true);
    setToolError("");
    if (tool === "analyzer") setAnalysisResult(null);
    else setGuideResult(null);
    try {
      const response = await fetch(`http://localhost:8000/api/skills/${tool === "analyzer" ? "repository-analyzer" : "contribution-guide"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repository: repoUrl.trim() })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `Request failed (${response.status}).`);
      if (tool === "analyzer") setAnalysisResult(data);
      else setGuideResult(data);
    } catch (error) {
      setToolError(error instanceof Error ? error.message : "Could not connect to the backend.");
    } finally {
      setToolLoading(false);
    }
  }

  async function generatePlan(issue: Issue) {
    setActivePage("planner");
    setPlanIssueNumber(issue.number);
    setPlanLoading(true);
    setContributionPlan("");
    setPlanError("");

    try {
      const response = await fetch("http://localhost:8000/api/ai/plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: issue.title,
          description: issue.description,
          repository: repoName,
        }),
      });

      let data: PlanResponse;

      try {
        data = (await response.json()) as PlanResponse;
      } catch {
        throw new Error(
          "The backend returned an invalid response. Check your Express server."
        );
      }

      if (!response.ok || !data.success || !data.plan) {
        throw new Error(
          data.error ||
            `AI request failed (${response.status}). Check Ollama and the backend.`
        );
      }

      setContributionPlan(data.plan);
    } catch (error) {
      setPlanError(
        error instanceof Error
          ? error.message
          : "Could not connect to the AI backend."
      );
    } finally {
      setPlanLoading(false);
    }
  }

  function openPrWriter(issue: Issue) {
    setSelectedIssueNumber(String(issue.number));
    setPrTitle(`Fix: ${issue.title}`);
    setPrDescription(
      `## Summary\n\nDescribe the changes made to address #${issue.number}.\n\n` +
        `## Related issue\n\nCloses #${issue.number}\n\n` +
        `## Changes made\n\n- [ ] Explain the main change\n- [ ] Describe any additional improvements\n\n` +
        `## Testing\n\n- [ ] Tests pass\n- [ ] Manually verified the fix\n\n` +
        `## Repository\n\n${repoName}\n`
    );
    setActivePage("pr");
  }

  function copyPrDraft() {
    const draft = `# ${prTitle}\n\n${prDescription}`;

    void navigator.clipboard
      .writeText(draft)
      .then(() => setMessage("PR draft copied to clipboard."))
      .catch(() =>
        setMessage("Copy failed. Select the draft text and copy it manually.")
      );
  }

  function renderIssueList() {
    if (loading) {
      return <div className="empty-state">Loading GitHub issues...</div>;
    }

    if (issues.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-icon">⌕</div>
          <h3>Your next contribution starts here</h3>
          <p>
            Search a repository above to see real open issues, descriptions,
            and labels.
          </p>
        </div>
      );
    }

    return (
      <>
        <div className="issue-filters">
          <button
            type="button"
            className={!showBeginnerOnly ? "filter-active" : ""}
            onClick={() => setShowBeginnerOnly(false)}
          >
            All Issues ({issues.length})
          </button>
          <button
            type="button"
            className={showBeginnerOnly ? "filter-active" : ""}
            onClick={() => setShowBeginnerOnly(true)}
          >
            Beginner Friendly ({beginnerIssues.length})
          </button>
        </div>

        {visibleIssues.length === 0 ? (
          <div className="empty-state">
            <h3>No matching beginner-friendly issues</h3>
            <p>
              None of the loaded issues has a good first issue, beginner, or
              help wanted label. Choose All Issues to see every result.
            </p>
          </div>
        ) : (
          <div className="issue-list">
            {visibleIssues.map((issue) => (
              <article className="issue-card" key={issue.number}>
                <div className="issue-top">
                  <span className="issue-number">#{issue.number}</span>
                  <span className="issue-open">● Open issue</span>
                </div>

                <h3>{issue.title}</h3>
                <p className="issue-description">
                  {issue.description.slice(0, 400)}
                  {issue.description.length > 400 ? "…" : ""}
                </p>

                <div className="labels">
                  {issue.labels.length ? (
                    issue.labels.map((label) => (
                      <span className="label" key={label}>
                        {label}
                      </span>
                    ))
                  ) : (
                    <span className="label muted">No labels</span>
                  )}
                </div>

                {issue.labels.some((label) =>
                  ["good first issue", "beginner", "help wanted"].includes(
                    label.toLowerCase()
                  )
                ) && (
                  <span className="beginner-tag">
                    Potential beginner match · based on labels
                  </span>
                )}

                <div className="issue-actions">
                  <a href={issue.url} target="_blank" rel="noreferrer">
                    View on GitHub ↗
                  </a>
                  <button
                    type="button"
                    className="generate-plan-button"
                    disabled={planLoading}
                    onClick={() => void generatePlan(issue)}
                  >
                    {planLoading && planIssueNumber === issue.number
                      ? "Generating plan..."
                      : "✦ Generate Contribution Plan"}
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => openPrWriter(issue)}
                  >
                    ☷ Draft PR
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">✳</span>
          <span>OpenSource Mate</span>
        </div>

        <p className="nav-label">WORKSPACE</p>

        <button
          type="button"
          className={`nav-item ${activePage === "dashboard" ? "active" : ""}`}
          onClick={() => setActivePage("dashboard")}
        >
          ⌂ &nbsp; Dashboard
        </button>
        <button
          type="button"
          className={`nav-item ${activePage === "issues" ? "active" : ""}`}
          onClick={() => setActivePage("issues")}
        >
          ⌕ &nbsp; Issue Finder
        </button>
        <button
          type="button"
          className={`nav-item ${activePage === "planner" ? "active" : ""}`}
          onClick={() => setActivePage("planner")}
        >
          ✧ &nbsp; AI Contribution Planner
        </button>
        <button
          type="button"
          className={`nav-item ${activePage === "pr" ? "active" : ""}`}
          onClick={() => setActivePage("pr")}
        >
          ☷ &nbsp; PR Writer
        </button>
        <button type="button" className={`nav-item ${activePage === "analyzer" ? "active" : ""}`} onClick={() => setActivePage("analyzer")}>
          ◈ &nbsp; Analyze Repository
        </button>
        <button type="button" className={`nav-item ${activePage === "guide" ? "active" : ""}`} onClick={() => setActivePage("guide")}>
          ☷ &nbsp; Contribution Guide
        </button>

        <div className="sidebar-bottom">
          <div className="status-dot" />
          GitHub issue discovery
          <p>Open-source contribution starts here.</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <span className="breadcrumb">
            Workspace /{" "}
            {{
              dashboard: "Dashboard",
              issues: "Issue Finder",
              planner: "AI Contribution Planner",
              pr: "PR Writer",
              analyzer: "Analyze Repository",
              guide: "Contribution Guide",
            }[activePage]}
          </span>
          <div className="topbar-actions">
            <div className="theme-switch" role="group" aria-label="Color theme">
              <button type="button" aria-pressed={theme === "light"} className={theme === "light" ? "selected" : ""} onClick={() => changeTheme("light")}>☀ Light</button>
              <button type="button" aria-pressed={theme === "dark"} className={theme === "dark" ? "selected" : ""} onClick={() => changeTheme("dark")}>☾ Dark</button>
            </div>
            <span className="ai-badge">✦ Local AI · Llama 3.2</span>
          </div>
        </header>

        {activePage === "dashboard" && (
          <>
            <section className="welcome">
              <p className="eyebrow">YOUR OPEN-SOURCE JOURNEY</p>
              <h1>Make your first contribution.</h1>
              <p className="subtitle">
                Discover real GitHub issues and turn confusion into a clear
                plan.
              </p>
            </section>

            <section className="search-panel">
              <div className="panel-heading">
                <div>
                  <h2>Explore a repository</h2>
                  <p>Start with any public GitHub repository.</p>
                </div>
                <span className="github-icon">GH</span>
              </div>

              <label htmlFor="repoUrl">GitHub repository URL</label>
              <div className="search-row">
                <input
                  id="repoUrl"
                  value={repoUrl}
                  onChange={(event) => setRepoUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void findIssues();
                  }}
                  placeholder="https://github.com/owner/repository"
                />
                <button
                  type="button"
                  onClick={() => void findIssues()}
                  disabled={loading}
                >
                  {loading ? "Searching..." : "Find Issues →"}
                </button>
              </div>

              <p className="helper">
                Try{" "}
                <button
                  type="button"
                  className="example-link"
                  onClick={() => setRepoUrl("https://github.com/vitejs/vite")}
                >
                  vitejs/vite
                </button>{" "}
                or{" "}
                <button
                  type="button"
                  className="example-link"
                  onClick={() =>
                    setRepoUrl(
                      "https://github.com/firstcontributions/first-contributions"
                    )
                  }
                >
                  firstcontributions/first-contributions
                </button>
              </p>
            </section>

            <section className="stats-grid">
              <div className="stat-card">
                <span className="stat-icon purple">⌘</span>
                <p>Repository</p>
                <h3>{repoName || "Not selected"}</h3>
              </div>
              <div className="stat-card">
                <span className="stat-icon green">✓</span>
                <p>Open issues loaded</p>
                <h3>{issues.length}</h3>
              </div>
              <div className="stat-card">
                <span className="stat-icon orange">✦</span>
                <p>Beginner-friendly labels</p>
                <h3>{beginnerIssues.length}</h3>
              </div>
            </section>

            {message && (
              <div className="message" role="status" aria-live="polite">
                {message}
              </div>
            )}

            <section className="issues-section">
              <div className="section-heading">
                <div>
                  <h2>
                    {repoName ? "Repository issues" : "Ready to discover issues?"}
                  </h2>
                  <p>
                    {repoName
                      ? "Results are retrieved from the public GitHub API."
                      : "Enter a repository above to load real open issues."}
                  </p>
                </div>
                <span className="live-badge">● LIVE DATA</span>
              </div>
              {renderIssueList()}
            </section>
          </>
        )}

        {activePage === "issues" && (
          <>
            <section className="welcome">
              <p className="eyebrow">FIND YOUR NEXT TASK</p>
              <h1>GitHub Issue Finder</h1>
              <p className="subtitle">
                Load issues, filter beginner-friendly tasks, and open the
                original GitHub discussion.
              </p>
            </section>

            <section className="search-panel">
              <div className="panel-heading">
                <div>
                  <h2>Find repository issues</h2>
                  <p>Use the owner/repository URL of a public GitHub project.</p>
                </div>
                <span className="github-icon">GH</span>
              </div>
              <label htmlFor="issueRepoUrl">GitHub repository URL</label>
              <div className="search-row">
                <input
                  id="issueRepoUrl"
                  value={repoUrl}
                  onChange={(event) => setRepoUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void findIssues();
                  }}
                  placeholder="https://github.com/owner/repository"
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void findIssues()}
                >
                  {loading ? "Searching..." : "Find Issues →"}
                </button>
              </div>
              {message && <p role="status">{message}</p>}
            </section>

            <section className="issues-section">
              <div className="section-heading">
                <div>
                  <h2>{repoName || "Repository issues"}</h2>
                  <p>{issues.length} open issues loaded in this session.</p>
                </div>
                <span className="live-badge">● LIVE DATA</span>
              </div>
              {renderIssueList()}
            </section>
          </>
        )}

        {activePage === "planner" && (
          <>
            <section className="welcome">
              <p className="eyebrow">LOCAL MODEL · OLLAMA</p>
              <h1>AI Contribution Planner</h1>
              <p className="subtitle">
                Choose a loaded GitHub issue and ask your local model to break
                it into beginner-friendly steps.
              </p>
            </section>

            <section className="search-panel">
              <h2>Choose an issue</h2>
              <p>
                {repoName
                  ? `Current repository: ${repoName}`
                  : "First load a public repository in Dashboard or Issue Finder."}
              </p>

              {issues.length > 0 ? (
                <>
                  <label htmlFor="plannerIssue">GitHub issue</label>
                  <select
                    id="plannerIssue"
                    value={selectedIssueNumber || (planIssueNumber ? String(planIssueNumber) : "")}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSelectedIssueNumber(value);
                      setPlanIssueNumber(null);
                      setContributionPlan("");
                      setPlanError("");
                    }}
                  >
                    <option value="">Choose an issue...</option>
                    {issues.map((issue) => (
                      <option key={issue.number} value={issue.number}>
                        #{issue.number} — {issue.title}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    disabled={
                      planLoading ||
                      !(selectedIssue || issues.find((i) => i.number === planIssueNumber))
                    }
                    onClick={() => {
                      const issue =
                        selectedIssue ||
                        issues.find((i) => i.number === planIssueNumber);
                      if (issue) void generatePlan(issue);
                    }}
                  >
                    {planLoading ? "Generating plan..." : "✦ Generate AI Plan"}
                  </button>
                </>
              ) : (
                <div className="empty-state">
                  <h3>No issues loaded yet</h3>
                  <p>Load a repository first, then return to the planner.</p>
                  <button
                    type="button"
                    onClick={() => setActivePage("issues")}
                  >
                    Open Issue Finder
                  </button>
                </div>
              )}
            </section>

            {planIssueNumber !== null && (
              <section className="issues-section contribution-plan">
                <h2>AI Contribution Plan</h2>
                {planLoading && (
                  <p role="status">
                    Local AI is analyzing this issue. Please wait...
                  </p>
                )}
                {!planLoading && planError && (
                  <p className="plan-error" role="alert">
                    {planError}
                  </p>
                )}
                {!planLoading && contributionPlan && (
                  <pre>{contributionPlan}</pre>
                )}
              </section>
            )}
          </>
        )}

        {activePage === "pr" && (
          <>
            <section className="welcome">
              <p className="eyebrow">PREPARE YOUR CONTRIBUTION</p>
              <h1>PR Writer</h1>
              <p className="subtitle">
                Create a pull-request title and description draft that you can
                edit and copy to GitHub.
              </p>
            </section>

            <section className="search-panel">
              <h2>Start from a loaded issue</h2>
              {issues.length > 0 ? (
                <>
                  <label htmlFor="prIssue">Related issue</label>
                  <select
                    id="prIssue"
                    value={selectedIssueNumber}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSelectedIssueNumber(value);
                      const issue = issues.find(
                        (item) => item.number === Number(value)
                      );
                      if (issue) openPrWriter(issue);
                    }}
                  >
                    <option value="">Choose an issue...</option>
                    {issues.map((issue) => (
                      <option key={issue.number} value={issue.number}>
                        #{issue.number} — {issue.title}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <p>
                  Load a repository and its issues first, then come back here.
                </p>
              )}

              <label htmlFor="prTitle">Pull request title</label>
              <input
                id="prTitle"
                value={prTitle}
                onChange={(event) => setPrTitle(event.target.value)}
                placeholder="Fix: describe your change"
              />

              <label htmlFor="prDescription">Pull request description</label>
              <textarea
                id="prDescription"
                value={prDescription}
                onChange={(event) => setPrDescription(event.target.value)}
                rows={14}
                placeholder="Describe the change, related issue, and tests..."
              />

              <div className="issue-actions">
                <button
                  type="button"
                  disabled={!prTitle.trim() || !prDescription.trim()}
                  onClick={copyPrDraft}
                >
                  Copy PR Draft
                </button>
                {selectedIssue && (
                  <a href={selectedIssue.url} target="_blank" rel="noreferrer">
                    Open related issue ↗
                  </a>
                )}
              </div>
              <p className="helper">
                This creates a local draft only. It does not publish a pull
                request or push code to GitHub.
              </p>
            </section>
          </>
        )}

        {(activePage === "analyzer" || activePage === "guide") && (
          <>
            <section className="welcome">
              <p className="eyebrow">REPOSITORY TOOLKIT</p>
              <h1>{activePage === "analyzer" ? "Analyze Repository" : "Contribution Guide"}</h1>
              <p className="subtitle">{activePage === "analyzer" ? "Inspect real repository files, technologies, scripts, and project overview." : "Generate practical contribution steps grounded in repository documentation."}</p>
            </section>
            <section className="search-panel">
              <div className="panel-heading">
                <div><h2>{activePage === "analyzer" ? "Repository analysis" : "Build your contribution guide"}</h2><p>Enter a public GitHub repository URL. Results come from inspected GitHub evidence.</p></div>
                <span className="github-icon">GH</span>
              </div>
              <label htmlFor="toolRepoUrl">GitHub repository URL</label>
              <div className="search-row">
                <input id="toolRepoUrl" value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repository" onKeyDown={(event) => { if (event.key === "Enter") void runRepositoryTool(activePage === "analyzer" ? "analyzer" : "guide"); }} />
                <button type="button" disabled={toolLoading} onClick={() => void runRepositoryTool(activePage === "analyzer" ? "analyzer" : "guide")}>{toolLoading ? "Inspecting..." : activePage === "analyzer" ? "Analyze →" : "Generate guide →"}</button>
              </div>
              {toolError && <p className="message error-message" role="alert">{toolError}</p>}
            </section>
            {activePage === "analyzer" && analysisResult && (
              <section className="search-panel tool-results">
                <div className="section-heading"><div><h2>{analysisResult.repository}</h2><p>Default branch: {analysisResult.defaultBranch || "Not verified"}</p></div><a href={analysisResult.repositoryUrl} target="_blank" rel="noreferrer">Open GitHub ↗</a></div>
                <h3>README overview</h3><pre>{analysisResult.overview || "No README content found."}</pre>
                <h3>Detected dependencies / technologies</h3><div className="labels">{(analysisResult.technologies || []).length ? analysisResult.technologies.map((item: string) => <span className="label" key={item}>{item}</span>) : <span>No package dependencies were detected in inspected files.</span>}</div>
                <h3>Available scripts</h3><pre>{JSON.stringify(analysisResult.availableScripts || {}, null, 2)}</pre>
                <h3>Inspected files</h3><ul>{(analysisResult.inspectedFiles || []).map((file: {path:string;url:string}) => <li key={file.path}><a href={file.url || "#"} target="_blank" rel="noreferrer">{file.path}</a></li>)}</ul>
                {(analysisResult.warnings || []).map((warning: string) => <p className="helper" key={warning}>Note: {warning}</p>)}
              </section>
            )}
            {activePage === "guide" && guideResult && (
              <section className="search-panel tool-results">
                <div className="section-heading"><div><h2>Contribution guide</h2><p>{guideResult.repository}</p></div><button type="button" onClick={() => { void navigator.clipboard.writeText(guideResult.guide).then(() => setMessage("Contribution guide copied.")).catch(() => setToolError("Clipboard access failed; select and copy the guide manually.")); }}>Copy guide</button></div>
                <pre className="guide-content">{guideResult.guide}</pre>
                <h3>Inspected files</h3><ul>{(guideResult.inspectedFiles || []).map((file: {path:string;url:string}) => <li key={file.path}><a href={file.url || "#"} target="_blank" rel="noreferrer">{file.path}</a></li>)}</ul>
                {(guideResult.warnings || []).map((warning: string) => <p className="helper" key={warning}>Note: {warning}</p>)}
              </section>
            )}
          </>
        )}
        {message && (activePage === "guide" || activePage === "analyzer") && <p className="message" role="status">{message}</p>}
        <footer>
          OpenSource Mate AI · Built to make open-source contributions easier.
        </footer>
      </main>
    </div>
  );
}

export default App;
