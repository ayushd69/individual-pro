import { useCallback, useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import './App.css'

const roleNames = {
  'system-admin': 'System Admin',
  'it-manager': 'IT Manager',
  technician: 'Technician',
  employee: 'Employee',
  'asset-manager': 'Asset Manager',
}

const ticketCategories = ['General', 'Hardware', 'Laptop', 'Charger', 'Mouse', 'CPU', 'Keyboard', 'Monitor', 'Printer', 'Software', 'Network', 'Asset']
const assetTypes = ['laptop', 'desktop', 'monitor', 'printer', 'router', 'server', 'mobile', 'software-license', 'charger', 'cpu', 'mouse', 'keyboard', 'headset', 'docking-station', 'other']

const navigation = [
  { id: 'overview', label: 'Overview', icon: '▦', roles: Object.keys(roleNames) },
  { id: 'tickets', label: 'Tickets', icon: '◎', roles: Object.keys(roleNames) },
  { id: 'assets', label: 'Assets', icon: '⬡', roles: Object.keys(roleNames) },
  { id: 'knowledge', label: 'Knowledge', icon: '▤', roles: Object.keys(roleNames) },
  { id: 'people', label: 'People', icon: '♙', roles: ['system-admin'] },
  { id: 'reports', label: 'Reports', icon: '▥', roles: ['system-admin', 'it-manager', 'asset-manager'] },
  { id: 'notifications', label: 'Notifications', icon: '♧', roles: Object.keys(roleNames) },
]

const knowledgeArticles = [
  { title: 'Connect securely to the company VPN', category: 'Network', readTime: '4 min', summary: 'Check your connection, sign in with your work account, and refresh your VPN profile.' },
  { title: 'Prepare a laptop for repair', category: 'Hardware', readTime: '3 min', summary: 'Back up company files, record the asset tag, and submit a hardware support request.' },
  { title: 'Request access to a business application', category: 'Access', readTime: '2 min', summary: 'Include the application name, your team, and the business reason in your request.' },
  { title: 'Troubleshoot common Wi-Fi issues', category: 'Network', readTime: '5 min', summary: 'Reconnect to the approved network, restart Wi-Fi, and include your location when reporting issues.' },
]

const sectionContent = {
  overview: { title: 'Overview', description: 'A live view of your service desk workspace.' },
  tickets: { title: 'Tickets', description: 'Track, create, and update support requests.' },
  assets: { title: 'Assets', description: 'Manage the equipment and devices in your organization.' },
  knowledge: { title: 'Knowledge', description: 'Guides and answers for common support questions.' },
  people: { title: 'People', description: 'Manage team accounts and access roles.' },
  reports: { title: 'Reports', description: 'Service activity and inventory insights.' },
  notifications: { title: 'Notifications', description: 'Recent updates from your service desk.' },
}

async function api(path, token, options = {}) {
  const isMultipart = options.body instanceof FormData
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body && !isMultipart ? { 'Content-Type': 'application/json' } : {}),
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
  const [availableAssets, setAvailableAssets] = useState([])
  const [assetRequests, setAssetRequests] = useState([])
  const [notifications, setNotifications] = useState([])
  const [technicians, setTechnicians] = useState([])
  const [articles, setArticles] = useState([])
  const [slas, setSlas] = useState([])
  const [vendors, setVendors] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [activeForm, setActiveForm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [activeSection, setActiveSection] = useState('overview')
  const [search, setSearch] = useState('')
  const [deletingUserId, setDeletingUserId] = useState('')
  const [chatTicket, setChatTicket] = useState(null)
  const [chatMessages, setChatMessages] = useState([])
  const [chatDraft, setChatDraft] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [assignmentIds, setAssignmentIds] = useState({})
  const [assetSelection, setAssetSelection] = useState({})
  const [workLogTicket, setWorkLogTicket] = useState(null)
  const [requestReasons, setRequestReasons] = useState({})

  useEffect(() => {
    if (!notice) return undefined
    const timeoutId = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(timeoutId)
  }, [notice])

  const loadWorkspace = useCallback(async (accessToken) => {
    const [me, overview, ticketResult, assetResult, notificationResult, articleResult] = await Promise.all([
      api('/auth/me', accessToken),
      api('/dashboard', accessToken),
      api('/tickets', accessToken),
      api('/assets', accessToken),
      api('/notifications', accessToken),
      api('/knowledge', accessToken),
    ])
    setUser(me.user)
    setDashboard(overview)
    setTickets(ticketResult.tickets)
    setAssets(assetResult.assets)
    setNotifications(notificationResult.notifications)
    setArticles(articleResult.articles)
    if (['system-admin', 'it-manager', 'technician', 'asset-manager'].includes(me.user.role)) {
      const requestResult = await api('/asset-requests', accessToken)
      setAssetRequests(requestResult.requests)
    } else {
      setAssetRequests([])
    }
    if (me.user.role === 'technician') {
      const availableResult = await api('/assets/available', accessToken)
      setAvailableAssets(availableResult.assets)
    } else {
      setAvailableAssets([])
    }
    if (me.user.role === 'system-admin') {
      const userResult = await api('/users', accessToken)
      setUsers(userResult.users)
    } else {
      setUsers([])
    }
    if (['system-admin', 'it-manager'].includes(me.user.role)) {
      const technicianResult = await api('/technicians', accessToken)
      setTechnicians(technicianResult.technicians)
      const slaResult = await api('/slas', accessToken)
      setSlas(slaResult.slas)
    } else {
      setTechnicians([])
      setSlas([])
    }
    if (['system-admin', 'asset-manager', 'it-manager'].includes(me.user.role)) {
      const vendorResult = await api('/vendors', accessToken)
      setVendors(vendorResult.vendors)
    } else {
      setVendors([])
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

  useEffect(() => {
    if (!token) return undefined
    const socket = io({ auth: { token } })
    socket.on('notification:new', (notification) => {
      setNotifications((current) => [notification, ...current.filter((item) => item._id !== notification._id)])
    })
    socket.on('ticket:updated', () => {
      loadWorkspace(token).catch((loadError) => setError(loadError.message))
    })
    socket.on('ticket:message', (message) => {
      setChatMessages((current) => current.some((item) => item._id === message._id) ? current : [...current, message])
    })
    socket.on('ticket:internal-message', (message) => {
      setChatMessages((current) => current.some((item) => item._id === message._id) ? current : [...current, message])
    })
    return () => socket.disconnect()
  }, [token, loadWorkspace])

  useEffect(() => {
    if (!chatTicket || !token) return undefined
    let mounted = true
    const socket = io({ auth: { token } })
    setChatMessages([])
    api(`/tickets/${chatTicket._id}/messages`, token)
      .then(({ messages }) => { if (mounted) setChatMessages(messages) })
      .catch((loadError) => { if (mounted) setError(loadError.message) })
    socket.on('connect', () => socket.emit('ticket:join', { ticketId: chatTicket._id }))
    socket.on('ticket:message', (message) => {
      if (mounted && message.ticket === chatTicket._id) {
        setChatMessages((current) => current.some((item) => item._id === message._id) ? current : [...current, message])
      }
    })
    socket.on('ticket:internal-message', (message) => {
      if (mounted && message.ticket === chatTicket._id) {
        setChatMessages((current) => current.some((item) => item._id === message._id) ? current : [...current, message])
      }
    })
    return () => { mounted = false; socket.disconnect() }
  }, [chatTicket, token])

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
    setActiveSection('overview')
    setSearch('')
    setNotice('')
  }

  async function handleCreate(event, resource) {
    event.preventDefault()
    const formElement = event.currentTarget
    setError('')
    setNotice('')
    const form = new FormData(formElement)
    const values = Object.fromEntries(form.entries())
    const attachments = formElement.elements.attachments?.files
    delete values.attachments
    if (!values.warrantyUntil) delete values.warrantyUntil
    try {
      const result = await api(resource, token, { method: 'POST', body: JSON.stringify(values) })
      if (resource === '/tickets' && attachments?.length) {
        const files = new FormData()
        for (const file of attachments) files.append('files', file)
        await api(`/tickets/${result.ticket._id}/attachments`, token, { method: 'POST', body: files })
      }
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

  async function updateAsset(assetId, status) {
    setError('')
    try {
      await api(`/assets/${assetId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      await loadWorkspace(token)
      setNotice('Asset lifecycle updated.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function assignTicket(ticket) {
    const technicianId = assignmentIds[ticket._id]
    if (!technicianId) return setError('Select a technician before assigning the ticket')
    setError('')
    try {
      await api(`/tickets/${ticket._id}/assignments`, token, {
        method: 'POST',
        body: JSON.stringify({ technicianId }),
      })
      await loadWorkspace(token)
      setNotice('Assignment approval request sent to the technician.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function respondToAssignment(ticket, decision) {
    const assignmentResult = await api(`/tickets/${ticket._id}/assignments`, token)
    const assignment = assignmentResult.assignments.find((item) => item.current && item.status === 'pending')
    if (!assignment) return setError('This assignment is no longer awaiting your response')
    const reason = decision === 'reject' ? window.prompt('Please provide a reason for rejecting this assignment:') : ''
    if (decision === 'reject' && !reason?.trim()) return
    setError('')
    try {
      await api(`/tickets/${ticket._id}/assignments/${assignment._id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
      })
      await loadWorkspace(token)
      setNotice(decision === 'accept' ? 'Assignment accepted. You can now begin work.' : 'Assignment rejected and the manager was notified.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function requestAsset(ticket) {
    const assetId = assetSelection[ticket._id]
    if (!assetId) return setError('Choose an available asset to request')
    setError('')
    try {
      await api(`/tickets/${ticket._id}/asset-requests`, token, {
        method: 'POST',
        body: JSON.stringify({ assetId }),
      })
      await loadWorkspace(token)
      setNotice('Asset request sent to the Asset Manager.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function reviewAssetRequest(request, decision) {
    const reason = decision === 'reject' ? window.prompt('Please provide a reason for rejecting this asset request:') : ''
    if (decision === 'reject' && !reason?.trim()) return
    setError('')
    try {
      await api(`/asset-requests/${request._id}/review`, token, {
        method: 'PATCH',
        body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
      })
      await loadWorkspace(token)
      setNotice(decision === 'approve' ? 'Request approved. Issue the asset to complete approval.' : 'Request rejected and technician notified.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function issueAsset(request) {
    setError('')
    try {
      await api(`/asset-requests/${request._id}/issue`, token, {
        method: 'POST',
        body: JSON.stringify({ condition: 'Issued in good condition' }),
      })
      await loadWorkspace(token)
      setNotice('Asset issued and ticket returned to In Progress.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function returnAsset(request) {
    const condition = window.prompt('Describe the asset condition on return:')
    if (!condition?.trim()) return
    setError('')
    try {
      await api(`/asset-requests/${request._id}/return`, token, {
        method: 'POST',
        body: JSON.stringify({ condition }),
      })
      await loadWorkspace(token)
      setNotice('Asset returned and marked available.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function sendChatMessage(event) {
    event.preventDefault()
    if (!chatTicket || !chatDraft.trim()) return
    setChatBusy(true)
    setError('')
    try {
      const { message } = await api(`/tickets/${chatTicket._id}/messages`, token, {
        method: 'POST',
        body: JSON.stringify({ body: chatDraft.trim() }),
      })
      setChatMessages((current) => current.some((item) => item._id === message._id) ? current : [...current, message])
      setChatDraft('')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setChatBusy(false)
    }
  }

  async function addWorkLog(event) {
    event.preventDefault()
    if (!workLogTicket) return
    const form = new FormData(event.currentTarget)
    try {
      await api(`/tickets/${workLogTicket._id}/work-logs`, token, {
        method: 'POST',
        body: JSON.stringify({ minutes: Number(form.get('minutes')), note: form.get('note') }),
      })
      setWorkLogTicket(null)
      setNotice('Work log recorded.')
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function markNotificationsRead() {
    try {
      await api('/notifications/read-all', token, { method: 'PATCH', body: '{}' })
      setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })))
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function deleteUser(member) {
    const confirmed = window.confirm(`Delete the ${roleNames[member.role]} account for ${member.name} (${member.email})? This cannot be undone.`)
    if (!confirmed) return

    setError('')
    setNotice('')
    setDeletingUserId(member.id)
    try {
      await api(`/users/${member.id}`, token, { method: 'DELETE' })
      await loadWorkspace(token)
      setNotice(`${member.name}'s account was deleted.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setDeletingUserId('')
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
          </section>
        </div>
      </main>
    )
  }

  const visibleNavigation = navigation.filter((item) => item.roles.includes(user.role))
  const currentSection = sectionContent[activeSection] || sectionContent.overview
  const normalizedSearch = search.trim().toLowerCase()
  const filteredTickets = tickets.filter((ticket) =>
    [ticket.title, ticket.category, ticket.status, ticket.priority, ticket.requester?.name]
      .some((value) => String(value || '').toLowerCase().includes(normalizedSearch)),
  )
  const filteredAssets = assets.filter((asset) =>
    [asset.name, asset.assetTag, asset.category, asset.status, asset.assignedTo?.name]
      .some((value) => String(value || '').toLowerCase().includes(normalizedSearch)),
  )
  const filteredUsers = users.filter((member) =>
    [member.name, member.email, member.department, roleNames[member.role]]
      .some((value) => String(value || '').toLowerCase().includes(normalizedSearch)),
  )
  const actionForm = activeSection === 'tickets' || activeSection === 'overview'
    ? 'ticket'
    : activeSection === 'assets'
      ? 'asset'
      : activeSection === 'people'
        ? 'user'
        : ''
  const canAddAsset = ['system-admin', 'asset-manager'].includes(user.role)

  function openCreateForm(form) {
    setActiveForm(activeForm === form ? '' : form)
  }

  function renderTicketTable(rows) {
    if (!rows.length) {
      return <div className="workspace-empty"><span>◎</span><strong>No tickets found</strong><p>{normalizedSearch ? 'Try a different search.' : 'New support requests will appear here.'}</p></div>
    }
    return (
      <div className="workspace-table-scroll">
        <table className="workspace-table">
          <thead><tr><th>Ticket</th><th>Requester</th><th>Category</th><th>Priority</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((ticket) => (
              <tr key={ticket._id}>
                <td><strong>{ticket.title}</strong><small>{ticket._id.slice(-8).toUpperCase()}</small></td>
                <td>{ticket.requester?.name || 'You'}</td>
                <td>{ticket.category}</td>
                <td><span className={`priority-tag ${ticket.priority}`}>{ticket.priority}</span></td>
                <td>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  function renderAssetTable(rows) {
    if (!rows.length) {
      return <div className="workspace-empty"><span>⬡</span><strong>No assets found</strong><p>{normalizedSearch ? 'Try a different search.' : 'Registered assets will appear in this list.'}</p></div>
    }
    return (
      <div className="workspace-table-scroll">
        <table className="workspace-table asset-table">
          <thead><tr><th>Asset ID</th><th>Name</th><th>Type</th><th>Serial / Tag</th><th>Status</th><th>Lifecycle</th></tr></thead>
          <tbody>
            {rows.map((asset) => (
              <tr key={asset._id}>
                <td>{asset.assetTag}</td>
                <td><strong>{asset.name}</strong></td>
                <td>{asset.category}</td>
                <td>{asset.assetTag}</td>
                <td><span className={`asset-status ${asset.status}`}>{asset.status}</span></td>
                <td>
                  <label className="status-control" aria-label={`Lifecycle for ${asset.name}`}>
                    <select
                      value={asset.status}
                      disabled={!canAddAsset}
                      onChange={(event) => updateAsset(asset._id, event.target.value)}
                    >
                      {['available', 'assigned', 'repair', 'retired'].map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  function renderCreateForm() {
    if (!activeForm) return null
    const resource = activeForm === 'ticket' ? '/tickets' : activeForm === 'asset' ? '/assets' : '/users'
    return (
      <section className="form-card">
        <div className="panel-header">
          <h2>{activeForm === 'ticket' ? 'Create a support ticket' : activeForm === 'asset' ? 'Register an asset' : 'Create an account'}</h2>
          <button className="text-button" onClick={() => setActiveForm('')} type="button">Close</button>
        </div>
        <form className="data-form" onSubmit={(event) => handleCreate(event, resource)}>
          {activeForm === 'ticket' && (
            <>
              <label>Title<input name="title" required maxLength="160" /></label>
              <label>Category<select name="category">{ticketCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label>Priority<select name="priority"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
              <label className="wide-field">Description<textarea name="description" rows="3" required maxLength="5000" /></label>
            </>
          )}
          {activeForm === 'asset' && (
            <>
              <label>Asset name<input name="name" required /></label>
              <label>Asset tag<input name="assetTag" required /></label>
              <label>Type / category<select name="category" required>{assetTypes.map((type) => <option key={type} value={type}>{type === 'cpu' ? 'CPU' : type.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ')}</option>)}</select></label>
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
    )
  }

  function renderAssets() {
    return (
      <section className="record-card workspace-record">
        <div className="workspace-record-heading"><div><h2>Organization assets</h2><p>{filteredAssets.length} assets in this view</p></div></div>
        {renderAssetTable(filteredAssets)}
      </section>
    )
  }

  function renderTickets() {
    return (
      <section className="record-card workspace-record">
        <div className="workspace-record-heading"><div><h2>Service requests</h2><p>{filteredTickets.length} tickets visible to your account</p></div></div>
        {renderTicketTable(filteredTickets)}
      </section>
    )
  }

  function renderOverview() {
    return (
      <>
        <section className="metric-grid live-metrics" aria-label="Dashboard metrics">
          {(dashboard?.metrics || []).map((metric) => (
            <article className="metric-card" key={metric.label}>
              <p>{metric.label}</p><strong>{metric.value}</strong><span>{metric.trend}</span>
            </article>
          ))}
        </section>
        <div className="overview-grid">
          <section className="record-card workspace-record">
            <div className="workspace-record-heading"><div><h2>Recent tickets</h2><p>Latest service requests</p></div><button className="link-button" onClick={() => setActiveSection('tickets')} type="button">View all →</button></div>
            {renderTicketTable(filteredTickets.slice(0, 5))}
          </section>
          <section className="record-card workspace-record">
            <div className="workspace-record-heading"><div><h2>Asset inventory</h2><p>{filteredAssets.length} records visible</p></div><button className="link-button" onClick={() => setActiveSection('assets')} type="button">View all →</button></div>
            {renderAssetTable(filteredAssets.slice(0, 5))}
          </section>
        </div>
        {user.role === 'system-admin' && (
          <section className="record-card workspace-record">
            <div className="workspace-record-heading"><div><h2>Team accounts</h2><p>{filteredUsers.length} accounts and roles</p></div><button className="link-button" onClick={() => setActiveSection('people')} type="button">Manage people →</button></div>
            {renderPeopleTable(filteredUsers.slice(0, 5))}
          </section>
        )}
      </>
    )
  }

  function renderPeopleTable(rows) {
    if (!rows.length) return <div className="workspace-empty"><strong>No team accounts found</strong><p>Create a user account to get started.</p></div>
    return (
      <div className="workspace-table-scroll">
        <table className="workspace-table">
          <thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Role</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((member) => (
            <tr key={member.id}>
              <td><strong>{member.name}</strong></td>
              <td>{member.email}</td>
              <td>{member.department || '—'}</td>
              <td><span className="role-label">{roleNames[member.role]}</span></td>
              <td>
                {member.role === 'system-admin'
                  ? <span className="protected-account">Protected</span>
                  : <button className="delete-user-button" type="button" disabled={deletingUserId === member.id} onClick={() => deleteUser(member)}>{deletingUserId === member.id ? 'Deleting…' : 'Delete'}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    )
  }

  function renderKnowledge() {
    const articles = knowledgeArticles.filter((article) =>
      [article.title, article.category, article.summary].some((value) => value.toLowerCase().includes(normalizedSearch)),
    )
    return (
      <div className="knowledge-grid">
        {articles.map((article) => (
          <article className="knowledge-card" key={article.title}>
            <span className="knowledge-icon">▤</span>
            <div className="knowledge-meta"><span>{article.category}</span><small>{article.readTime} read</small></div>
            <h2>{article.title}</h2>
            <p>{article.summary}</p>
            <button type="button" className="link-button">Read guide <span>→</span></button>
          </article>
        ))}
        {!articles.length && <p className="empty-state">No guides match your search.</p>}
      </div>
    )
  }

  function renderReports() {
    const openTickets = tickets.filter((ticket) => ['open', 'in-progress', 'pending'].includes(ticket.status)).length
    const resolvedTickets = tickets.filter((ticket) => ['resolved', 'closed'].includes(ticket.status)).length
    const attentionAssets = assets.filter((asset) => ['repair', 'retired'].includes(asset.status)).length
    return (
      <div className="reports-grid">
        <article className="report-card"><span>Ticket backlog</span><strong>{openTickets}</strong><small>Open and in progress</small><div className="report-meter"><span style={{ width: `${tickets.length ? Math.max(8, (openTickets / tickets.length) * 100) : 0}%` }} /></div></article>
        <article className="report-card"><span>Resolved requests</span><strong>{resolvedTickets}</strong><small>Resolved or closed tickets</small><div className="report-meter green"><span style={{ width: `${tickets.length ? Math.max(8, (resolvedTickets / tickets.length) * 100) : 0}%` }} /></div></article>
        <article className="report-card"><span>Assets requiring attention</span><strong>{attentionAssets}</strong><small>Repair or retired lifecycle</small><div className="report-meter amber"><span style={{ width: `${assets.length ? Math.max(8, (attentionAssets / assets.length) * 100) : 0}%` }} /></div></article>
        <article className="report-card"><span>Tracked inventory</span><strong>{assets.length}</strong><small>Assets visible to your role</small><div className="report-meter purple"><span style={{ width: `${assets.length ? 100 : 0}%` }} /></div></article>
      </div>
    )
  }

  function renderNotifications() {
    const recent = [...tickets]
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .filter((ticket) => [ticket.title, ticket.status, ticket.priority].some((value) => String(value || '').toLowerCase().includes(normalizedSearch)))
    return (
      <section className="record-card workspace-record">
        <div className="workspace-record-heading"><div><h2>Ticket updates</h2><p>Recent activity for requests available to your role</p></div></div>
        {!recent.length ? <div className="workspace-empty"><span>♧</span><strong>You’re all caught up</strong><p>Updates to your tickets will show here.</p></div> : (
          <div className="activity-list">{recent.map((ticket) => (
            <article className="activity-row" key={ticket._id}>
              <span className="activity-mark">◎</span>
              <div><strong>{ticket.title}</strong><p>Ticket is <b>{ticket.status}</b> · {ticket.priority} priority</p></div>
              <time>{new Date(ticket.updatedAt).toLocaleDateString()}</time>
            </article>
          ))}</div>
        )}
      </section>
    )
  }

  function renderSection() {
    if (activeSection === 'overview') return renderOverview()
    if (activeSection === 'tickets') return renderTickets()
    if (activeSection === 'assets') return renderAssets()
    if (activeSection === 'people' && user.role === 'system-admin') {
      return <section className="record-card workspace-record"><div className="workspace-record-heading"><div><h2>Team accounts</h2><p>{filteredUsers.length} accounts and assigned roles</p></div></div>{renderPeopleTable(filteredUsers)}</section>
    }
    if (activeSection === 'knowledge') return renderKnowledge()
    if (activeSection === 'reports' && ['system-admin', 'it-manager', 'asset-manager'].includes(user.role)) return renderReports()
    if (activeSection === 'notifications') return renderNotifications()
    return renderOverview()
  }

  return (
    <div className="app-layout">
      <aside className="side-navigation">
        <a className="sidebar-brand" href="#overview">
          <span className="brand-mark small-mark">SD</span>
          <span className="sidebar-brand-copy"><strong>ServiceDesk Pro</strong><small>SERVICE OPERATIONS</small></span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav className="workspace-navigation" aria-label="Workspace navigation">
          {visibleNavigation.map((item) => (
            <button
              className={activeSection === item.id ? 'nav-item active' : 'nav-item'}
              key={item.id}
              type="button"
              onClick={() => {
                setActiveSection(item.id)
                setActiveForm('')
                setSearch('')
              }}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === 'tickets' && tickets.filter((ticket) => ['open', 'in-progress'].includes(ticket.status)).length > 0 && (
                <span className="nav-count">{tickets.filter((ticket) => ['open', 'in-progress'].includes(ticket.status)).length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-profile">
            <span className="profile-avatar">{user.name.charAt(0).toUpperCase()}</span>
            <span className="sidebar-profile-copy"><strong>{user.name}</strong><small>{roleNames[user.role]}</small></span>
            <button className="profile-menu-button" type="button" onClick={signOut} aria-label="Sign out">↗</button>
          </div>
        </div>
      </aside>

      <div className="workspace-frame">
        <header className="workspace-topbar">
          <div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{currentSection.title}</strong></div>
          <div className="topbar-tools">
            <label className="workspace-search">
              <span aria-hidden="true">⌕</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${activeSection === 'overview' ? 'this view' : currentSection.title.toLowerCase()}`} aria-label={`Search ${currentSection.title}`} />
              {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search">×</button>}
            </label>
            <button className="topbar-icon-button" type="button" onClick={() => setActiveSection('notifications')} aria-label="Notifications">♧</button>
            <span className="topbar-divider" />
            <button className="topbar-avatar" type="button" title={`${user.name} · ${roleNames[user.role]}`}>{user.name.charAt(0).toUpperCase()}</button>
          </div>
        </header>

        <main className="workspace-content">
          {error && <div className="message error-message" role="alert">{error}</div>}
          {notice && <div className="message success-message" role="status">{notice}</div>}
          <section className="section-heading">
            <div><p className="mini-label">SERVICE MANAGEMENT</p><h1>{currentSection.title}</h1><p>{activeSection === 'overview' ? `${roleNames[user.role]} · ${user.department || 'Service operations'}` : currentSection.description}</p></div>
            <div className="section-actions">
              {activeSection === 'tickets' && <button className="primary-button" onClick={() => openCreateForm('ticket')} type="button"><span>＋</span> New Ticket</button>}
              {activeSection === 'assets' && canAddAsset && <button className="primary-button" onClick={() => openCreateForm('asset')} type="button"><span>＋</span> Add Asset</button>}
              {activeSection === 'people' && user.role === 'system-admin' && <button className="primary-button" onClick={() => openCreateForm('user')} type="button"><span>＋</span> Add User</button>}
              {activeSection === 'overview' && (
                <>
                  <span className="health-chip"><span className="dot" /> Connected</span>
                  <button className="primary-button" onClick={() => openCreateForm('ticket')} type="button"><span>＋</span> New Ticket</button>
                </>
              )}
            </div>
          </section>
          {renderCreateForm()}
          {renderSection()}
        </main>
      </div>
    </div>
  )
}

export default App
