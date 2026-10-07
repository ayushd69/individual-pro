import 'dotenv/config'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'

const roles = ['system-admin', 'it-manager', 'technician', 'employee', 'asset-manager']
const ticketStatuses = ['open', 'in-progress', 'pending', 'resolved', 'closed']
const priorities = ['low', 'medium', 'high', 'critical']
const assetStatuses = ['available', 'assigned', 'repair', 'retired']
const app = express()

app.use(helmet())
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json({ limit: '1mb' }))
app.use((req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {}
  next()
})

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: roles, required: true, default: 'employee' },
    department: { type: String, trim: true, maxlength: 100, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)
userSchema.index(
  { role: 1 },
  { unique: true, partialFilterExpression: { role: 'system-admin' } },
)

const ticketSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 5000 },
    priority: { type: String, enum: priorities, default: 'medium' },
    status: { type: String, enum: ticketStatuses, default: 'open' },
    category: { type: String, trim: true, maxlength: 80, default: 'General' },
    department: { type: String, trim: true, maxlength: 100, default: '' },
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

const assetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    assetTag: { type: String, required: true, unique: true, trim: true, uppercase: true },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    status: { type: String, enum: assetStatuses, default: 'available' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    department: { type: String, trim: true, maxlength: 100, default: '' },
    warrantyUntil: { type: Date, default: null },
  },
  { timestamps: true },
)

const auditSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    resource: { type: String, required: true },
    resourceId: { type: String, default: '' },
  },
  { timestamps: true },
)

const User = mongoose.model('User', userSchema)
const Ticket = mongoose.model('Ticket', ticketSchema)
const Asset = mongoose.model('Asset', assetSchema)
const AuditLog = mongoose.model('AuditLog', auditSchema)

function fail(res, status, message) {
  return res.status(status).json({ error: message })
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
  }
}

function ticketFilterFor(user) {
  if (user.role === 'employee') return { requester: new mongoose.Types.ObjectId(user.id) }
  if (user.role === 'technician') return { assignee: new mongoose.Types.ObjectId(user.id) }
  if (user.role === 'asset-manager') return { category: { $in: ['Hardware', 'Asset'] } }
  if (user.role === 'it-manager' && user.department) return { department: user.department }
  return {}
}

function assetFilterFor(user) {
  if (user.role === 'employee' || user.role === 'technician') {
    return { assignedTo: new mongoose.Types.ObjectId(user.id) }
  }
  return {}
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
  )
}

const authenticate = asyncRoute(async (req, res, next) => {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
  if (!token) return fail(res, 401, 'Authentication required')

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(payload.sub)
    if (!user || !user.active) return fail(res, 401, 'Account is unavailable')
    req.user = user
    next()
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return fail(res, 401, 'Invalid or expired session')
    }
    throw error
  }
})

function allowRoles(...allowed) {
  return (req, res, next) => {
    if (!allowed.includes(req.user.role)) return fail(res, 403, 'Insufficient role permissions')
    next()
  }
}

async function writeAudit(actor, action, resource, resourceId = '') {
  await AuditLog.create({ actor, action, resource, resourceId })
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  })
})

app.post(
  '/api/auth/login',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }),
  asyncRoute(async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    const password = typeof req.body.password === 'string' ? req.body.password : ''
    if (!email || !password) return fail(res, 400, 'Email and password are required')

    const user = await User.findOne({ email }).select('+passwordHash')
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
      return fail(res, 401, 'Email or password is incorrect')
    }
    res.json({ token: signToken(user), user: safeUser(user) })
  }),
)

app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: safeUser(req.user) }))

app.post('/api/auth/logout', authenticate, (req, res) => {
  res.json({ message: 'Signed out. Remove the access token from this device.' })
})

app.get(
  '/api/users',
  authenticate,
  allowRoles('system-admin'),
  asyncRoute(async (req, res) => {
    const users = await User.find().sort({ createdAt: -1 })
    res.json({ users: users.map(safeUser) })
  }),
)

app.post(
  '/api/users',
  authenticate,
  allowRoles('system-admin'),
  asyncRoute(async (req, res) => {
    const { name, email, password, role, department = '' } = req.body
    if (![name, email, password, role].every((value) => typeof value === 'string' && value.trim())) {
      return fail(res, 400, 'Name, email, password, and role are required')
    }
    if (!roles.includes(role)) return fail(res, 400, 'Invalid role')
    if (password.length < 12) return fail(res, 400, 'Password must be at least 12 characters')
    if (role === 'system-admin') return fail(res, 403, 'Only the bootstrapped system administrator is permitted')

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await User.create({ name, email, passwordHash, role, department })
    await writeAudit(req.user.id, 'user.created', 'user', user.id)
    res.status(201).json({ user: safeUser(user) })
  }),
)

app.get(
  '/api/tickets',
  authenticate,
  asyncRoute(async (req, res) => {
    const query = ticketFilterFor(req.user)
    if (typeof req.query.status === 'string' && ticketStatuses.includes(req.query.status)) {
      query.status = req.query.status
    }
    const tickets = await Ticket.find(query)
      .populate('requester', 'name email')
      .populate('assignee', 'name email')
      .sort({ createdAt: -1 })
      .limit(100)
    res.json({ tickets })
  }),
)

app.post(
  '/api/tickets',
  authenticate,
  asyncRoute(async (req, res) => {
    const { title, description, priority = 'medium', category = 'General' } = req.body
    if (typeof title !== 'string' || !title.trim() || typeof description !== 'string' || !description.trim()) {
      return fail(res, 400, 'Ticket title and description are required')
    }
    if (!priorities.includes(priority)) return fail(res, 400, 'Invalid priority')
    const ticket = await Ticket.create({
      title,
      description,
      priority,
      category,
      requester: req.user.id,
      department: req.user.department,
    })
    await writeAudit(req.user.id, 'ticket.created', 'ticket', ticket.id)
    res.status(201).json({ ticket })
  }),
)

app.patch(
  '/api/tickets/:id',
  authenticate,
  asyncRoute(async (req, res) => {
    const ticket = await Ticket.findById(req.params.id)
    if (!ticket) return fail(res, 404, 'Ticket not found')
    if (req.user.role === 'employee' && String(ticket.requester) !== req.user.id) {
      return fail(res, 403, 'You can only update your own tickets')
    }
    if (req.user.role === 'technician' && String(ticket.assignee) !== req.user.id) {
      return fail(res, 403, 'You can only update tickets assigned to you')
    }
    if (req.user.role === 'asset-manager' && !['Hardware', 'Asset'].includes(ticket.category)) {
      return fail(res, 403, 'Asset managers can only update hardware or asset tickets')
    }
    const canManage = ['system-admin', 'it-manager', 'technician'].includes(req.user.role)
    if (!canManage && Object.keys(req.body).some((key) => key !== 'status')) {
      return fail(res, 403, 'Insufficient role permissions')
    }
    const updates = {}
    for (const field of ['status', 'priority', 'assignee', 'category']) {
      if (req.body[field] === undefined) continue
      if (field === 'status' && !ticketStatuses.includes(req.body[field])) return fail(res, 400, 'Invalid ticket status')
      if (field === 'priority' && !priorities.includes(req.body[field])) return fail(res, 400, 'Invalid ticket priority')
      if (field === 'assignee' && !mongoose.isValidObjectId(req.body[field])) return fail(res, 400, 'Invalid assignee')
      if (field === 'category' && typeof req.body[field] !== 'string') return fail(res, 400, 'Invalid category')
      updates[field] = req.body[field]
    }
    if (!Object.keys(updates).length) return fail(res, 400, 'No supported fields to update')
    if (req.user.role === 'technician' && updates.assignee) {
      return fail(res, 403, 'Technicians cannot reassign tickets')
    }
    if (updates.assignee) {
      const assignee = await User.findOne({ _id: updates.assignee, role: 'technician', active: true })
      if (!assignee) return fail(res, 400, 'Assignee must be an active technician')
    }
    if (
      req.user.role === 'employee' &&
      updates.status &&
      (updates.status !== 'closed' || ticket.status !== 'resolved')
    ) {
      return fail(res, 403, 'Employees can only confirm closure after a ticket is resolved')
    }
    Object.assign(ticket, updates)
    await ticket.save()
    await writeAudit(req.user.id, 'ticket.updated', 'ticket', ticket.id)
    res.json({ ticket })
  }),
)

app.get(
  '/api/assets',
  authenticate,
  asyncRoute(async (req, res) => {
    const query = assetFilterFor(req.user)
    const assets = await Asset.find(query).populate('assignedTo', 'name email').sort({ createdAt: -1 }).limit(100)
    res.json({ assets })
  }),
)

app.post(
  '/api/assets',
  authenticate,
  allowRoles('system-admin', 'asset-manager'),
  asyncRoute(async (req, res) => {
    const { name, assetTag, category, status = 'available', department = '', warrantyUntil } = req.body
    if (![name, assetTag, category].every((value) => typeof value === 'string' && value.trim())) {
      return fail(res, 400, 'Asset name, tag, and category are required')
    }
    if (!assetStatuses.includes(status)) return fail(res, 400, 'Invalid asset status')
    const asset = await Asset.create({ name, assetTag, category, status, department, warrantyUntil })
    await writeAudit(req.user.id, 'asset.created', 'asset', asset.id)
    res.status(201).json({ asset })
  }),
)

app.patch(
  '/api/assets/:id',
  authenticate,
  allowRoles('system-admin', 'asset-manager'),
  asyncRoute(async (req, res) => {
    const allowed = ['status', 'assignedTo', 'department', 'warrantyUntil']
    const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)))
    if (!Object.keys(updates).length) return fail(res, 400, 'No supported asset fields to update')
    if (updates.status && !assetStatuses.includes(updates.status)) return fail(res, 400, 'Invalid asset status')
    if (updates.assignedTo && !mongoose.isValidObjectId(updates.assignedTo)) return fail(res, 400, 'Invalid assignee')
    const asset = await Asset.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
      .populate('assignedTo', 'name email')
    if (!asset) return fail(res, 404, 'Asset not found')
    await writeAudit(req.user.id, 'asset.updated', 'asset', asset.id)
    res.json({ asset })
  }),
)

app.get(
  '/api/dashboard',
  authenticate,
  asyncRoute(async (req, res) => {
    const ticketFilter = ticketFilterFor(req.user)
    const assetFilter = assetFilterFor(req.user)

    const [ticketCounts, totalAssets, activeUsers, tickets, assetsAtRisk] = await Promise.all([
      Ticket.aggregate([
        { $match: ticketFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Asset.countDocuments(assetFilter),
      req.user.role === 'system-admin' || req.user.role === 'it-manager'
        ? User.countDocuments({
            active: true,
            ...(req.user.role === 'it-manager' && req.user.department ? { department: req.user.department } : {}),
          })
        : Promise.resolve(null),
      Ticket.find(ticketFilter)
        .populate('requester', 'name')
        .populate('assignee', 'name')
        .sort({ createdAt: -1 })
        .limit(5),
      Asset.countDocuments({ ...assetFilter, status: { $in: ['repair', 'retired'] } }),
    ])
    const counts = Object.fromEntries(ticketCounts.map(({ _id, count }) => [_id, count]))
    const open = (counts.open || 0) + (counts['in-progress'] || 0) + (counts.pending || 0)
    const metrics = [
      { label: 'Open tickets', value: String(open), trend: `${counts['in-progress'] || 0} in progress` },
      { label: 'Resolved', value: String((counts.resolved || 0) + (counts.closed || 0)), trend: 'All time' },
      { label: 'Tracked assets', value: String(totalAssets), trend: `${assetsAtRisk} need attention` },
      ...(activeUsers === null
        ? [{ label: 'My role', value: req.user.role.replace('-', ' '), trend: req.user.department || 'Service desk' }]
        : [{ label: 'Active users', value: String(activeUsers), trend: 'All departments' }]),
    ]
    res.json({
      metrics,
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        title: ticket.title,
        priority: ticket.priority,
        status: ticket.status,
        requester: ticket.requester?.name || 'Unknown',
        assignee: ticket.assignee?.name || 'Unassigned',
      })),
      role: req.user.role,
    })
  }),
)

app.get(
  '/api/audit',
  authenticate,
  allowRoles('system-admin'),
  asyncRoute(async (req, res) => {
    const logs = await AuditLog.find().populate('actor', 'name email role').sort({ createdAt: -1 }).limit(100)
    res.json({ logs })
  }),
)

app.use((req, res) => fail(res, 404, 'API route not found'))
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  if (error instanceof SyntaxError && error.status === 400) return fail(res, 400, 'Request body contains invalid JSON')
  if (error.code === 11000) return fail(res, 409, 'Email or asset tag already exists')
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return fail(res, 400, 'Request contains invalid data')
  }
  console.error(error)
  return fail(res, 500, 'An unexpected server error occurred')
})

async function bootstrapAdmin() {
  const adminExists = await User.exists({ role: 'system-admin' })
  if (adminExists) return

  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('Set ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD to create the initial administrator')
  }
  if (ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters')

  await User.create({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
    role: 'system-admin',
  })
  console.log(`Bootstrapped system administrator: ${ADMIN_EMAIL}`)
}

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI must be configured')
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters')
  }
  await mongoose.connect(process.env.MONGODB_URI)
  await User.init()
  await bootstrapAdmin()
  const port = Number(process.env.PORT || 4000)
  app.listen(port, () => console.log(`ServiceDesk API listening on http://localhost:${port}`))
}

start().catch((error) => {
  console.error('Failed to start ServiceDesk API:', error.message)
  process.exitCode = 1
})
