import { useCallback, useEffect, useState } from 'react'
import './App.css'

const roleNames = {
  'system-admin': 'System Admin',
  'it-manager': 'IT Manager',
  technician: 'Technician',
  employee: 'Employee',
  'asset-manager': 'Asset Manager',
}

async function api(path, token, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`)
  return result
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('servicedesk-token') || '')
  const [user, setUser] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [tickets, setTickets] = useState([])
  const [assets, setAssets] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [activeForm, setActiveForm] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const loadWorkspace = useCallback(async (accessToken) => {
    const [me, overview, ticketResult, assetResult] = await Promise.all([
      api('/auth/me', accessToken),
      api('/dashboard', accessToken),
      api('/tickets', accessToken),
      api('/assets', accessToken),
    ])
    setUser(me.user)
    setDashboard(overview)
    setTickets(ticketResult.tickets)
    setAssets(assetResult.assets)
    if (me.user.role === 'system-admin') {
      const userResult = await api('/users', accessToken)
      setUsers(userResult.users)
    }
  }, [])

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    let mounted = true
    setLoading(true)
    loadWorkspace(token)
      .catch((loadError) => {
        if (mounted) {
          localStorage.removeItem('servicedesk-token')
          setToken('')
          setError(loadError.message)
        }
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [token, loadWorkspace])

  async function handleLogin(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    const form = new FormData(event.currentTarget)
    try {
      const result = await api('/auth/login', '', {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
        }),
      })
      localStorage.setItem('servicedesk-token', result.token)
      setUser(result.user)
      setToken(result.token)
      setNotice(`Welcome, ${result.user.name}`)
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setLoading(false)
    }
  }

  function signOut() {
    localStorage.removeItem('servicedesk-token')
    setToken('')
    setUser(null)
    setDashboard(null)
    setTickets([])
    setAssets([])
    setUsers([])
    setActiveForm('')
    setNotice('')
  }

  async function handleCreate(event, resource) {
    event.preventDefault()
    const formElement = event.currentTarget
    setError('')
    setNotice('')
    const form = new FormData(formElement)
    const values = Object.fromEntries(form.entries())
    if (!values.warrantyUntil) delete values.warrantyUntil
    try {
      await api(resource, token, { method: 'POST', body: JSON.stringify(values) })
      await loadWorkspace(token)
      formElement.reset()
      setActiveForm('')
      setNotice(resource === '/tickets' ? 'Ticket created.' : resource === '/assets' ? 'Asset added.' : 'User created.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function updateTicket(ticketId, status) {
    setError('')
    try {
      await api(`/tickets/${ticketId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      await loadWorkspace(token)
      setNotice('Ticket status updated.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  if (loading && !user) {
    return <main className="auth-screen"><p className="loading-message">Connecting to ServiceDesk…</p></main>
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <div className="login-page">
          <section className="login-story">
            <div className="story-copy">
              <span className="story-kicker"><span className="story-kicker-dot" /> SERVICE MANAGEMENT</span>
              <h1>Support that keeps your<br className="desktop-break" /> team moving.</h1>
              <p>A clear place for service requests, incident response, and the assets your team relies on.</p>
            </div>
            <div className="story-benefits">
              <span><span className="benefit-icon">✓</span> Connected service operations</span>
              <span><span className="benefit-icon shield-icon">◇</span> Role-aware access</span>
            </div>
          </section>

          <section className="auth-card" id="signin">
            <div className="auth-heading">
              <p className="mini-label">WELCOME BACK</p>
              <h2>Sign in to your workspace</h2>
              <p className="auth-subtitle">Use your work account to continue.</p>
            </div>
            {error && <div className="message error-message" role="alert">{error}</div>}
            <form className="form-stack" onSubmit={handleLogin}>
              <label>Work email
                <input type="email" name="email" autoComplete="username" placeholder="employee@servicedesk.com" required />
              </label>
              <label>Password
                <span className="password-input-wrap">
                  <input type={showPassword ? 'text' : 'password'} name="password" autoComplete="current-password" placeholder="Enter your password" required />
                  <button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </span>
              </label>
              <button className="primary-button login-submit" type="submit" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
                {!loading && <span aria-hidden="true">➤</span>}
              </button>
            </form>
            <div className="auth-divider" />
            <div className="role-selector">
              <div className="role-selector-heading">
                <span>AVAILABLE ROLES</span>
                <small>Assigned by your administrator</small>
              </div>
              <div className="role-chips" aria-label="Available account roles">
                {Object.values(roleNames).map((role) => <span key={role}>{role}</span>)}
              </div>
            </div>
          </section>
        </div>
      </main>
    )
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        <a className="brand" href="#dashboard"><span className="brand-mark small-mark">SD</span> ServiceDesk<span>Pro</span></a>
        <div className="account-menu">
          <div className="account-details">
            <strong>{user.name}</strong>
            <span>{roleNames[user.role]}{user.department ? ` · ${user.department}` : ''}</span>
          </div>
          <button className="secondary-button" onClick={signOut} type="button">Sign out</button>
        </div>
      </header>

      <main id="dashboard" className="workspace">
        <div className="welcome-row">
          <div>
            <p className="mini-label">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            <h1>{roleNames[user.role]} dashboard</h1>
            <p className="muted-copy">Your service desk workspace and live operational data.</p>
          </div>
          <div className="health-chip"><span className="dot" /> API connected</div>
        </div>

        {error && <div className="message error-message" role="alert">{error}</div>}
        {notice && <div className="message success-message" role="status">{notice}</div>}

        <section className="metric-grid live-metrics" aria-label="Dashboard metrics">
          {(dashboard?.metrics || []).map((metric) => (
            <article className="metric-card" key={metric.label}>
              <p>{metric.label}</p><strong>{metric.value}</strong><span>{metric.trend}</span>
            </article>
          ))}
        </section>

        <section className="workspace-toolbar">
          <div><h2>Workspace</h2><p>Actions and records available to your role.</p></div>
          <div className="toolbar-actions">
            <button className="primary-button" onClick={() => setActiveForm(activeForm === 'ticket' ? '' : 'ticket')} type="button">+ New ticket</button>
            {(user.role === 'asset-manager' || user.role === 'system-admin') && (
              <button className="primary-button" onClick={() => setActiveForm(activeForm === 'asset' ? '' : 'asset')} type="button">+ Add asset</button>
            )}
            {user.role === 'system-admin' && (
              <button className="secondary-button" onClick={() => setActiveForm(activeForm === 'user' ? '' : 'user')} type="button">+ Add user</button>
            )}
          </div>
        </section>

        {activeForm && (
          <section className="form-card">
            <div className="panel-header">
              <h2>{activeForm === 'ticket' ? 'Create a support ticket' : activeForm === 'asset' ? 'Register an asset' : 'Create an account'}</h2>
              <button className="text-button" onClick={() => setActiveForm('')} type="button">Close</button>
            </div>
            <form
              className="data-form"
              onSubmit={(event) => handleCreate(event, activeForm === 'ticket' ? '/tickets' : activeForm === 'asset' ? '/assets' : '/users')}
            >
              {activeForm === 'ticket' && (
                <>
                  <label>Title<input name="title" required maxLength="160" /></label>
                  <label>Category<select name="category"><option>General</option><option>Hardware</option><option>Software</option><option>Network</option><option>Asset</option></select></label>
                  <label>Priority<select name="priority"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
                  <label className="wide-field">Description<textarea name="description" rows="3" required maxLength="5000" /></label>
                </>
              )}
              {activeForm === 'asset' && (
                <>
                  <label>Asset name<input name="name" required /></label>
                  <label>Asset tag<input name="assetTag" required /></label>
                  <label>Category<input name="category" placeholder="Laptop, monitor…" required /></label>
                  <label>Department<input name="department" /></label>
                  <label>Warranty until<input name="warrantyUntil" type="date" /></label>
                </>
              )}
              {activeForm === 'user' && (
                <>
                  <label>Full name<input name="name" required /></label>
                  <label>Email<input name="email" type="email" required /></label>
                  <label>Temporary password<input name="password" type="password" minLength="12" required /></label>
                  <label>Role<select name="role" required><option value="employee">Employee</option><option value="technician">Technician</option><option value="it-manager">IT Manager</option><option value="asset-manager">Asset Manager</option></select></label>
                  <label>Department<input name="department" /></label>
                </>
              )}
              <div className="wide-field"><button className="primary-button" type="submit">Save</button></div>
            </form>
          </section>
        )}

        <div className="records-grid">
          <section className="record-card">
            <div className="panel-header"><div><h2>Recent tickets</h2><p>{tickets.length} visible to your account</p></div><span className="record-count">{tickets.length}</span></div>
            {tickets.length === 0 ? <p className="empty-state">No tickets yet. Create a ticket to get started.</p> : (
              <div className="record-list">
                {tickets.map((ticket) => (
                  <article className="record-row" key={ticket._id}>
                    <div className="record-title"><strong>{ticket.title}</strong><span>{ticket.category} · {ticket.requester?.name || 'You'}</span></div>
                    <span className={`priority-tag ${ticket.priority}`}>{ticket.priority}</span>
                    <label className="status-control" aria-label={`Status for ${ticket.title}`}>
                      <select
                        value={ticket.status}
                        disabled={user.role === 'employee' && ticket.status !== 'resolved'}
                        onChange={(event) => updateTicket(ticket._id, event.target.value)}
                      >
                        {(user.role === 'employee'
                          ? ticket.status === 'resolved' ? ['resolved', 'closed'] : [ticket.status]
                          : ['open', 'in-progress', 'pending', 'resolved', 'closed']
                        ).map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </label>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="record-card">
            <div className="panel-header"><div><h2>Asset inventory</h2><p>Registered devices and equipment</p></div><span className="record-count">{assets.length}</span></div>
            {assets.length === 0 ? <p className="empty-state">No assets have been registered.</p> : (
              <div className="record-list">
                {assets.slice(0, 8).map((asset) => (
                  <article className="record-row asset-row" key={asset._id}>
                    <div className="record-title"><strong>{asset.name}</strong><span>{asset.assetTag} · {asset.category}</span></div>
                    <span className={`asset-status ${asset.status}`}>{asset.status}</span>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        {user.role === 'system-admin' && (
          <section className="record-card admin-users">
            <div className="panel-header"><div><h2>Team accounts</h2><p>Accounts and assigned roles</p></div><span className="record-count">{users.length}</span></div>
            <div className="record-list">
              {users.map((member) => (
                <article className="record-row asset-row" key={member.id}>
                  <div className="record-title"><strong>{member.name}</strong><span>{member.email}{member.department ? ` · ${member.department}` : ''}</span></div>
                  <span className="asset-status assigned">{roleNames[member.role]}</span>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
      <footer className="app-footer">ServiceDesk Pro <span>Secure access based on your assigned role.</span></footer>
    </div>
  )
}

export default App
