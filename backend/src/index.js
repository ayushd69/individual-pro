import 'dotenv/config'
import crypto from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import mongoose from 'mongoose'
import { Server } from 'socket.io'

const roles = ['system-admin', 'it-manager', 'technician', 'employee', 'asset-manager']
const ticketStatuses = ['open', 'pending-technician-approval', 'assigned', 'in-progress', 'pending-asset', 'resolved', 'employee-confirmation', 'closed', 'reopened']
const priorities = ['low', 'medium', 'high', 'critical']
const assetStatuses = ['available', 'assigned', 'repair', 'lost', 'damaged', 'retired']
const assetTypes = ['laptop', 'desktop', 'monitor', 'printer', 'router', 'server', 'mobile', 'software-license', 'charger', 'cpu', 'mouse', 'keyboard', 'headset', 'docking-station', 'other']
const assetTicketCategories = ['Hardware', 'Asset', 'Laptop', 'Charger', 'Mouse', 'CPU', 'Keyboard', 'Monitor', 'Printer']
const server = createServer()
const app = express()
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' } })
mkdirSync('uploads', { recursive: true })

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
    skills: { type: [String], default: [] },
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
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    slaDueAt: { type: Date, default: null },
    slaEscalated: { type: Boolean, default: false },
    attachments: [{ name: String, path: String, mimeType: String, size: Number, uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, uploadedAt: { type: Date, default: Date.now } }],
    resolution: { type: String, trim: true, maxlength: 5000, default: '' },
  },
  { timestamps: true },
)

const assetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    assetTag: { type: String, required: true, unique: true, trim: true, uppercase: true },
    category: { type: String, required: true, enum: assetTypes, trim: true, maxlength: 80 },
    status: { type: String, enum: assetStatuses, default: 'available' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    department: { type: String, trim: true, maxlength: 100, default: '' },
    warrantyUntil: { type: Date, default: null },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
    serialNumber: { type: String, trim: true, maxlength: 120, default: '' },
    purchaseDate: { type: Date, default: null },
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

const assignmentSchema = new mongoose.Schema({
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },
  technician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected', 'superseded'], default: 'pending' },
  reason: { type: String, trim: true, maxlength: 1000, default: '' },
  requestedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null },
  current: { type: Boolean, default: true },
}, { timestamps: true })

const ticketMessageSchema = new mongoose.Schema({
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, trim: true, required: true, maxlength: 5000 },
  internal: { type: Boolean, default: false },
  attachments: [{ name: String, path: String, mimeType: String, size: Number }],
}, { timestamps: true })

const workLogSchema = new mongoose.Schema({
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },
  technician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  minutes: { type: Number, required: true, min: 1, max: 1440 },
  note: { type: String, required: true, trim: true, maxlength: 3000 },
}, { timestamps: true })

const assetRequestSchema = new mongoose.Schema({
  asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true, index: true },
  activeAsset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', unique: true, sparse: true },
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
  technician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'issued', 'returned'], default: 'pending', index: true },
  reason: { type: String, trim: true, maxlength: 1000, default: '' },
  conditionOut: { type: String, trim: true, maxlength: 500, default: '' },
  conditionIn: { type: String, trim: true, maxlength: 500, default: '' },
  requestedAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date, default: null },
  issuedAt: { type: Date, default: null },
  returnedAt: { type: Date, default: null },
}, { timestamps: true })

const assetTransactionSchema = new mongoose.Schema({
  asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true, index: true },
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null },
  assetRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'AssetRequest', default: null },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, enum: ['created', 'requested', 'approved', 'rejected', 'issued', 'returned', 'status-changed'], required: true },
  condition: { type: String, trim: true, maxlength: 500, default: '' },
  note: { type: String, trim: true, maxlength: 1000, default: '' },
}, { timestamps: true })

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  type: { type: String, required: true },
  message: { type: String, required: true, maxlength: 500 },
  resource: { type: String, default: '' },
  resourceId: { type: String, default: '' },
  readAt: { type: Date, default: null },
}, { timestamps: true })

const slaSchema = new mongoose.Schema({
  priority: { type: String, enum: priorities, required: true, unique: true },
  responseMinutes: { type: Number, required: true, min: 1 },
  resolutionMinutes: { type: Number, required: true, min: 1 },
  businessHoursOnly: { type: Boolean, default: false },
}, { timestamps: true })

const knowledgeArticleSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  body: { type: String, required: true, trim: true, maxlength: 10000 },
  category: { type: String, trim: true, maxlength: 80, default: 'General' },
  tags: { type: [String], default: [] },
  published: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true })
knowledgeArticleSchema.index({ title: 'text', body: 'text', tags: 'text' })

const vendorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  email: { type: String, trim: true, lowercase: true, default: '' },
  phone: { type: String, trim: true, maxlength: 40, default: '' },
  notes: { type: String, trim: true, maxlength: 2000, default: '' },
}, { timestamps: true })

const User = mongoose.model('User', userSchema)
const Ticket = mongoose.model('Ticket', ticketSchema)
const Asset = mongoose.model('Asset', assetSchema)
const AuditLog = mongoose.model('AuditLog', auditSchema)
const TicketAssignment = mongoose.model('TicketAssignment', assignmentSchema)
const TicketMessage = mongoose.model('TicketMessage', ticketMessageSchema)
const WorkLog = mongoose.model('WorkLog', workLogSchema)
const AssetRequest = mongoose.model('AssetRequest', assetRequestSchema)
const AssetTransaction = mongoose.model('AssetTransaction', assetTransactionSchema)
const Notification = mongoose.model('Notification', notificationSchema)
const SLA = mongoose.model('SLA', slaSchema)
const KnowledgeArticle = mongoose.model('KnowledgeArticle', knowledgeArticleSchema)
const Vendor = mongoose.model('Vendor', vendorSchema)

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => callback(null, 'uploads/'),
    filename: (req, file, callback) => callback(null, `${Date.now()}-${crypto.randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, callback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']
    if (!allowed.includes(file.mimetype)) return callback(new Error('Only images, PDF, and text attachments are accepted'))
    callback(null, true)
  },
})

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
  if (user.role === 'asset-manager') return { category: { $in: assetTicketCategories } }
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

async function notify(recipient, actor, type, message, resource, resourceId) {
  if (!recipient) return
  const notification = await Notification.create({ recipient, actor, type, message, resource, resourceId })
  io.to(`user:${recipient}`).emit('notification:new', notification)
}

async function notifyManagers(ticket, actor, type, message) {
  const managers = await User.find({
    active: true,
    role: { $in: ['it-manager', 'system-admin'] },
    ...(ticket.department ? { department: ticket.department } : {}),
  }).select('_id')
  await Promise.all(managers.map((manager) => notify(manager._id, actor, type, message, 'ticket', ticket.id)))
}

function addBusinessMinutes(start, minutes) {
  const current = new Date(start)
  let remaining = minutes
  while (remaining > 0) {
    if (current.getDay() === 0 || current.getDay() === 6) {
      current.setDate(current.getDate() + (current.getDay() === 6 ? 2 : 1))
      current.setHours(9, 0, 0, 0)
      continue
    }
    if (current.getHours() < 9) current.setHours(9, 0, 0, 0)
    if (current.getHours() >= 17) {
      current.setDate(current.getDate() + 1)
      current.setHours(9, 0, 0, 0)
      continue
    }
    const available = (17 - current.getHours()) * 60 - current.getMinutes()
    const consumed = Math.min(remaining, available)
    current.setMinutes(current.getMinutes() + consumed)
    remaining -= consumed
  }
  return current
}

async function calculateSlaDueDate(priority) {
  const sla = await SLA.findOne({ priority })
  const fallbackMinutes = { critical: 60, high: 240, medium: 480, low: 1440 }[priority]
  const minutes = sla?.resolutionMinutes || fallbackMinutes
  return sla?.businessHoursOnly ? addBusinessMinutes(new Date(), minutes) : new Date(Date.now() + minutes * 60 * 1000)
}

async function getTicketForUser(ticketId, user) {
  if (!mongoose.isValidObjectId(ticketId)) return null
  const ticket = await Ticket.findById(ticketId)
  if (!ticket) return null
  if (['system-admin', 'it-manager'].includes(user.role)) return ticket
  if (user.role === 'employee' && String(ticket.requester) === user.id) return ticket
  if (user.role === 'technician' && (String(ticket.assignee) === user.id || await TicketAssignment.exists({ ticket: ticket.id, technician: user.id, current: true }))) return ticket
  if (user.role === 'asset-manager' && assetTicketCategories.includes(ticket.category)) return ticket
  return false
}

async function createAssignment(ticket, technician, manager) {
  await TicketAssignment.updateMany({ ticket: ticket._id, current: true }, { $set: { current: false, status: 'superseded' } })
  ticket.assignee = null
  ticket.status = 'pending-technician-approval'
  await ticket.save()
  const assignment = await TicketAssignment.create({
    ticket: ticket._id,
    technician: technician._id,
    assignedBy: manager._id,
  })
  await notify(technician._id, manager._id, 'ticket.assignment-requested', `Assignment approval requested for ${ticket.title}`, 'ticket', ticket.id)
  await writeAudit(manager.id, 'ticket.assignment-requested', 'ticket', ticket.id)
  io.to(`ticket:${ticket.id}`).emit('ticket:updated', { ticketId: ticket.id, status: ticket.status })
  return assignment
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(payload.sub)
    if (!user?.active) return next(new Error('Authentication required'))
    socket.data.user = user
    next()
  } catch {
    next(new Error('Authentication required'))
  }
})

io.on('connection', (socket) => {
  socket.join(`user:${socket.data.user.id}`)
  socket.on('ticket:join', async ({ ticketId }, acknowledge = () => {}) => {
    const access = await getTicketForUser(ticketId, socket.data.user)
    if (!access || access === false) return acknowledge({ error: 'Ticket access denied' })
    socket.join(`ticket:${ticketId}`)
    acknowledge({ ok: true })
  })
})

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
    const { name, email, password, role, department = '', skills = [] } = req.body
    if (![name, email, password, role].every((value) => typeof value === 'string' && value.trim())) {
      return fail(res, 400, 'Name, email, password, and role are required')
    }
    if (!roles.includes(role)) return fail(res, 400, 'Invalid role')
    if (password.length < 12) return fail(res, 400, 'Password must be at least 12 characters')
    if (role === 'system-admin') return fail(res, 403, 'Only the bootstrapped system administrator is permitted')

    const passwordHash = await bcrypt.hash(password, 12)
    if (!Array.isArray(skills) || skills.some((skill) => typeof skill !== 'string' || skill.length > 80)) {
      return fail(res, 400, 'Skills must be a list of short text values')
    }
    const user = await User.create({ name, email, passwordHash, role, department, skills })
    await writeAudit(req.user.id, 'user.created', 'user', user.id)
    res.status(201).json({ user: safeUser(user) })
  }),
)

app.delete(
  '/api/users/:id',
  authenticate,
  allowRoles('system-admin'),
  asyncRoute(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 400, 'Invalid user ID')
    if (req.params.id === req.user.id) return fail(res, 400, 'You cannot delete your own administrator account')

    const user = await User.findById(req.params.id)
    if (!user) return fail(res, 404, 'User not found')
    if (user.role === 'system-admin') return fail(res, 403, 'The system administrator account cannot be deleted')

    await writeAudit(req.user.id, 'user.deleted', 'user', user.id)
    await Promise.all([
      Ticket.updateMany({ requester: user._id }, { $set: { requester: null } }),
      Ticket.updateMany({ assignee: user._id }, { $set: { assignee: null } }),
      Asset.updateMany({ assignedTo: user._id }, { $set: { assignedTo: null } }),
      User.deleteOne({ _id: user._id }),
    ])
    res.json({ message: 'User account deleted' })
  }),
)

app.get(
  '/api/tickets',
  authenticate,
  asyncRoute(async (req, res) => {
    let query = ticketFilterFor(req.user)
    if (req.user.role === 'technician') {
      const pendingAssignments = await TicketAssignment.find({ technician: req.user._id, current: true, status: 'pending' }).distinct('ticket')
      query = { $or: [{ assignee: req.user._id }, { _id: { $in: pendingAssignments } }] }
    }
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

app.get(
  '/api/technicians',
  authenticate,
  allowRoles('system-admin', 'it-manager'),
  asyncRoute(async (req, res) => {
    const ticket = req.query.ticketId ? await Ticket.findById(req.query.ticketId) : null
    if (req.query.ticketId && !ticket) return fail(res, 404, 'Ticket not found')
    if (ticket && req.user.role === 'it-manager' && req.user.department && ticket.department !== req.user.department) {
      return fail(res, 403, 'Ticket belongs to another department')
    }
    const technicians = await User.find({
      role: 'technician',
      active: true,
      ...(req.user.role === 'it-manager' && req.user.department ? { department: req.user.department } : {}),
      ...(ticket?.department ? { department: ticket.department } : {}),
    }).select('name email department skills')
    const results = await Promise.all(technicians.map(async (technician) => {
      const workload = await Ticket.countDocuments({ assignee: technician._id, status: { $in: ['assigned', 'in-progress', 'pending-asset'] } })
      const category = ticket?.category?.toLowerCase() || ''
      const skillMatch = technician.skills.some((skill) => category.includes(skill.toLowerCase()) || skill.toLowerCase().includes(category))
      return { ...safeUser(technician), skills: technician.skills, workload, skillMatch }
    }))
    results.sort((a, b) => Number(b.skillMatch) - Number(a.skillMatch) || a.workload - b.workload)
    res.json({ technicians: results })
  }),
)

app.post(
  '/api/tickets',
  authenticate,
  asyncRoute(async (req, res) => {
    const { title, description, priority = 'medium', category = 'General', department = req.user.department } = req.body
    if (typeof title !== 'string' || !title.trim() || typeof description !== 'string' || !description.trim()) {
      return fail(res, 400, 'Ticket title and description are required')
    }
    if (!priorities.includes(priority)) return fail(res, 400, 'Invalid priority')
    if (typeof category !== 'string' || !category.trim() || category.length > 80) return fail(res, 400, 'A valid ticket category is required')
    if (typeof department !== 'string' || department.length > 100) return fail(res, 400, 'Invalid department')
    const ticket = await Ticket.create({
      title,
      description,
      priority,
      category,
      department: req.user.role === 'employee' ? req.user.department : department,
      requester: req.user.id,
      slaDueAt: await calculateSlaDueDate(priority),
    })
    if (req.user.role === 'employee') await notifyManagers(ticket, req.user.id, 'ticket.created', `New ticket requires triage: ${ticket.title}`)
    await writeAudit(req.user.id, 'ticket.created', 'ticket', ticket.id)
    res.status(201).json({ ticket })
  }),
)

app.post(
  '/api/tickets/:id/assignments',
  authenticate,
  allowRoles('system-admin', 'it-manager'),
  asyncRoute(async (req, res) => {
    const ticket = await Ticket.findById(req.params.id)
    if (!ticket) return fail(res, 404, 'Ticket not found')
    if (req.user.role === 'it-manager' && req.user.department && ticket.department !== req.user.department) {
      return fail(res, 403, 'Ticket belongs to another department')
    }
    const technicianId = req.body.technicianId
    if (!mongoose.isValidObjectId(technicianId)) return fail(res, 400, 'Select a valid technician')
    const technician = await User.findOne({
      _id: technicianId,
      role: 'technician',
      active: true,
      ...(ticket.department ? { department: ticket.department } : {}),
    })
    if (!technician) return fail(res, 400, 'Technician must be active and in the ticket department')
    const workload = await Ticket.countDocuments({ assignee: technician._id, status: { $in: ['assigned', 'in-progress', 'pending-asset'] } })
    if (workload >= 20 && req.body.overrideWorkload !== true) {
      return fail(res, 409, 'Technician workload is at capacity; explicitly confirm override to continue')
    }
    const assignment = await createAssignment(ticket, technician, req.user)
    res.status(201).json({ assignment, ticket })
  }),
)

app.get(
  '/api/tickets/:id/assignments',
  authenticate,
  asyncRoute(async (req, res) => {
    const access = await getTicketForUser(req.params.id, req.user)
    if (!access || access === false) return fail(res, access === false ? 403 : 404, 'Ticket not found or access denied')
    const assignments = await TicketAssignment.find({ ticket: req.params.id })
      .populate('technician', 'name email role skills')
      .populate('assignedBy', 'name email role')
      .sort({ requestedAt: -1 })
    res.json({ assignments })
  }),
)

app.patch(
  '/api/tickets/:id/assignments/:assignmentId',
  authenticate,
  allowRoles('technician'),
  asyncRoute(async (req, res) => {
    const decision = req.body.decision
    if (!['accept', 'reject'].includes(decision)) return fail(res, 400, 'Decision must be accept or reject')
    if (decision === 'reject' && (typeof req.body.reason !== 'string' || !req.body.reason.trim())) {
      return fail(res, 400, 'A reason is required when rejecting an assignment')
    }
    const assignment = await TicketAssignment.findOneAndUpdate({
      _id: req.params.assignmentId,
      ticket: req.params.id,
      technician: req.user.id,
      current: true,
      status: 'pending',
    }, {
      $set: {
        status: decision === 'accept' ? 'accepted' : 'rejected',
        reason: decision === 'reject' ? req.body.reason.trim().slice(0, 1000) : '',
        respondedAt: new Date(),
        ...(decision === 'reject' ? { current: false } : {}),
      },
    }, { new: true })
    if (!assignment) return fail(res, 404, 'Pending assignment request not found')

    const ticket = await Ticket.findById(req.params.id)
    if (!ticket) return fail(res, 404, 'Ticket not found')
    if (decision === 'accept') {
      if (ticket.status !== 'pending-technician-approval') {
        assignment.status = 'superseded'
        assignment.current = false
        await assignment.save()
        return fail(res, 409, 'This assignment was replaced before you accepted it')
      }
      ticket.assignee = req.user._id
      ticket.status = 'assigned'
    } else {
      ticket.assignee = null
      ticket.status = 'open'
    }
    await Promise.all([assignment.save(), ticket.save()])
    await notify(assignment.assignedBy, req.user.id, `ticket.assignment-${assignment.status}`, decision === 'accept'
      ? `${req.user.name} accepted ${ticket.title}`
      : `${req.user.name} rejected ${ticket.title}: ${assignment.reason}`, 'ticket', ticket.id)
    await writeAudit(req.user.id, `ticket.assignment-${assignment.status}`, 'ticket', ticket.id)
    io.to(`ticket:${ticket.id}`).emit('ticket:updated', { ticketId: ticket.id, status: ticket.status })
    res.json({ assignment, ticket })
  }),
)

app.get(
  '/api/tickets/:id/messages',
  authenticate,
  asyncRoute(async (req, res) => {
    const ticket = await getTicketForUser(req.params.id, req.user)
    if (!ticket || ticket === false) return fail(res, ticket === false ? 403 : 404, 'Ticket not found or access denied')
    const messages = await TicketMessage.find({
      ticket: ticket._id,
      ...(req.user.role === 'employee' ? { internal: false } : {}),
    }).populate('author', 'name role').sort({ createdAt: 1 }).limit(300)
    res.json({ messages })
  }),
)

app.post(
  '/api/tickets/:id/messages',
  authenticate,
  asyncRoute(async (req, res) => {
    const ticket = await getTicketForUser(req.params.id, req.user)
    if (!ticket || ticket === false) return fail(res, ticket === false ? 403 : 404, 'Ticket not found or access denied')
    const isParticipant = ['system-admin', 'it-manager'].includes(req.user.role) ||
      (req.user.role === 'technician' && String(ticket.assignee) === req.user.id)
    if (!isParticipant && req.user.role !== 'employee') return fail(res, 403, 'You cannot comment on this ticket')
    if (typeof req.body.body !== 'string' || !req.body.body.trim() || req.body.body.length > 5000) {
      return fail(res, 400, 'Comment must be between 1 and 5000 characters')
    }
    const internal = req.body.internal === true
    if (internal && !['system-admin', 'it-manager', 'technician'].includes(req.user.role)) {
      return fail(res, 403, 'Internal notes are for service staff only')
    }
    const message = await TicketMessage.create({ ticket: ticket._id, author: req.user._id, body: req.body.body.trim(), internal })
    await message.populate('author', 'name role')
    if (internal) {
      const recipients = await User.find({
        active: true,
        $or: [{ role: { $in: ['system-admin', 'it-manager'] } }, { _id: ticket.assignee }],
      }).select('_id')
      for (const recipient of recipients) io.to(`user:${recipient.id}`).emit('ticket:internal-message', message)
    } else {
      io.to(`ticket:${ticket.id}`).emit('ticket:message', message)
    }
    if (req.user.role === 'technician') await notifyManagers(ticket, req.user.id, 'ticket.comment', `Technician updated ${ticket.title}`)
    else if (req.user.role === 'employee') await notify(ticket.assignee, req.user.id, 'ticket.comment', `Requester commented on ${ticket.title}`, 'ticket', ticket.id)
    await writeAudit(req.user.id, internal ? 'ticket.internal-note' : 'ticket.comment', 'ticket', ticket.id)
    res.status(201).json({ message })
  }),
)

app.post(
  '/api/tickets/:id/work-logs',
  authenticate,
  allowRoles('technician'),
  asyncRoute(async (req, res) => {
    const ticket = await Ticket.findById(req.params.id)
    if (!ticket || String(ticket.assignee) !== req.user.id) return fail(res, 403, 'Work logs require an accepted assignment')
    if (!['assigned', 'in-progress', 'pending-asset'].includes(ticket.status)) return fail(res, 409, 'Work has not been accepted or is already complete')
    const minutes = Number(req.body.minutes)
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440 || typeof req.body.note !== 'string' || !req.body.note.trim()) {
      return fail(res, 400, 'Provide a work note and a duration between 1 and 1440 minutes')
    }
    const log = await WorkLog.create({ ticket: ticket._id, technician: req.user._id, minutes, note: req.body.note.trim() })
    await writeAudit(req.user.id, 'ticket.work-log-created', 'ticket', ticket.id)
    res.status(201).json({ workLog: log })
  }),
)

app.get(
  '/api/tickets/:id/work-logs',
  authenticate,
  asyncRoute(async (req, res) => {
    const ticket = await getTicketForUser(req.params.id, req.user)
    if (!ticket || ticket === false) return fail(res, ticket === false ? 403 : 404, 'Ticket not found or access denied')
    const workLogs = await WorkLog.find({ ticket: ticket._id }).populate('technician', 'name').sort({ createdAt: -1 })
    res.json({ workLogs })
  }),
)

app.post(
  '/api/tickets/:id/attachments',
  authenticate,
  upload.array('files', 5),
  asyncRoute(async (req, res) => {
    const ticket = await getTicketForUser(req.params.id, req.user)
    if (!ticket || ticket === false) return fail(res, ticket === false ? 403 : 404, 'Ticket not found or access denied')
    if (!req.files?.length) return fail(res, 400, 'Select at least one attachment')
    const files = req.files.map((file) => ({
      name: file.originalname,
      path: file.filename,
      mimeType: file.mimetype,
      size: file.size,
      uploadedBy: req.user._id,
    }))
    ticket.attachments.push(...files)
    await ticket.save()
    await writeAudit(req.user.id, 'ticket.attachment-added', 'ticket', ticket.id)
    res.status(201).json({ attachments: files })
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
    if (req.user.role === 'asset-manager' && !assetTicketCategories.includes(ticket.category)) {
      return fail(res, 403, 'Asset managers can only update hardware or asset tickets')
    }
    if (req.user.role === 'it-manager' && req.user.department && ticket.department !== req.user.department) {
      return fail(res, 403, 'Ticket belongs to another department')
    }
    const canManage = ['system-admin', 'it-manager'].includes(req.user.role)
    const updates = {}
    for (const field of ['status', 'priority', 'category', 'resolution']) {
      if (req.body[field] === undefined) continue
      if (field === 'status' && !ticketStatuses.includes(req.body[field])) return fail(res, 400, 'Invalid ticket status')
      if (field === 'priority' && !priorities.includes(req.body[field])) return fail(res, 400, 'Invalid ticket priority')
      if (['category', 'resolution'].includes(field) && typeof req.body[field] !== 'string') return fail(res, 400, `Invalid ${field}`)
      updates[field] = req.body[field]
    }
    if (!Object.keys(updates).length) return fail(res, 400, 'No supported fields to update')
    const allowedStatusMoves = {
      'system-admin': ticketStatuses,
      'it-manager': ['open'],
      technician: ['in-progress', 'pending-asset', 'employee-confirmation'],
      employee: ['closed', 'reopened'],
    }
    if (updates.status && !allowedStatusMoves[req.user.role]?.includes(updates.status)) {
      return fail(res, 403, 'Your role cannot set this ticket status')
    }
    if (req.user.role === 'employee' && updates.status === 'closed' && ticket.status !== 'employee-confirmation') {
      return fail(res, 409, 'You can close only after the technician requests employee confirmation')
    }
    if (req.user.role === 'employee' && updates.status === 'reopened' && !['employee-confirmation', 'closed'].includes(ticket.status)) {
      return fail(res, 409, 'Only resolved or closed tickets can be reopened')
    }
    if (req.user.role === 'technician') {
      if (ticket.status === 'pending-technician-approval' || ticket.status === 'open') {
        return fail(res, 409, 'Accept the assignment before starting work')
      }
      if (updates.status === 'in-progress' && !['assigned', 'pending-asset'].includes(ticket.status)) {
        return fail(res, 409, 'Ticket must be assigned or awaiting its requested asset before work can start')
      }
      if (updates.status === 'in-progress') {
        const undecidedAssetRequest = await AssetRequest.exists({
          ticket: ticket._id,
          technician: req.user._id,
          status: { $in: ['pending', 'approved'] },
        })
        if (undecidedAssetRequest) return fail(res, 409, 'Wait for the asset manager to approve and issue or reject the requested asset')
      }
      if (updates.status === 'pending-asset') {
        const activeRequest = await AssetRequest.exists({ ticket: ticket._id, technician: req.user._id, status: { $in: ['pending', 'approved'] } })
        if (!activeRequest) return fail(res, 409, 'Request an available asset before marking this ticket pending asset')
      }
      if (updates.status === 'employee-confirmation' && ticket.status !== 'in-progress') {
        return fail(res, 409, 'Only in-progress work can be submitted for employee confirmation')
      }
      if (updates.resolution && updates.status !== 'employee-confirmation') {
        return fail(res, 400, 'Submit the resolution together with employee confirmation')
      }
      if (updates.status === 'employee-confirmation' && (typeof (updates.resolution || ticket.resolution) !== 'string' || !(updates.resolution || ticket.resolution).trim())) {
        return fail(res, 400, 'A resolution summary is required')
      }
    }
    if (updates.priority && !canManage && req.user.role !== 'system-admin') {
      return fail(res, 403, 'Only managers can change priority')
    }
    if (updates.category && !canManage) {
      return fail(res, 403, 'Only managers can change category')
    }
    if (updates.status === 'reopened') {
      ticket.assignee = null
      await TicketAssignment.updateMany({ ticket: ticket._id, current: true }, { $set: { current: false } })
    }
    Object.assign(ticket, updates)
    if (updates.status === 'employee-confirmation') ticket.status = 'employee-confirmation'
    await ticket.save()
    await writeAudit(req.user.id, 'ticket.updated', 'ticket', ticket.id)
    if (ticket.status === 'employee-confirmation') {
      await notify(ticket.requester, req.user.id, 'ticket.resolution-ready', `Please confirm the resolution for ${ticket.title}`, 'ticket', ticket.id)
    } else if (ticket.status === 'closed') {
      await notify(ticket.assignee, req.user.id, 'ticket.closed', `Requester confirmed ${ticket.title}`, 'ticket', ticket.id)
    } else if (ticket.status === 'reopened') {
      await notifyManagers(ticket, req.user.id, 'ticket.reopened', `${ticket.title} was reopened by the requester`)
    }
    io.to(`ticket:${ticket.id}`).emit('ticket:updated', { ticketId: ticket.id, status: ticket.status })
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

app.get(
  '/api/assets/available',
  authenticate,
  allowRoles('technician', 'asset-manager', 'system-admin'),
  asyncRoute(async (req, res) => {
    const assets = await Asset.find({ status: 'available' }).sort({ category: 1, name: 1 }).limit(200)
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
    if (!assetTypes.includes(category)) return fail(res, 400, `Asset type must be one of: ${assetTypes.join(', ')}`)
    if (!assetStatuses.includes(status)) return fail(res, 400, 'Invalid asset status')
    const asset = await Asset.create({ name, assetTag, category, status, department, warrantyUntil })
    await writeAudit(req.user.id, 'asset.created', 'asset', asset.id)
    await AssetTransaction.create({ asset: asset._id, actor: req.user._id, action: 'created' })
    res.status(201).json({ asset })
  }),
)

app.patch(
  '/api/assets/:id',
  authenticate,
  allowRoles('system-admin', 'asset-manager'),
  asyncRoute(async (req, res) => {
    const allowed = ['status', 'department', 'warrantyUntil', 'vendor', 'serialNumber', 'purchaseDate']
    const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)))
    if (!Object.keys(updates).length) return fail(res, 400, 'No supported asset fields to update')
    if (updates.status && !assetStatuses.includes(updates.status)) return fail(res, 400, 'Invalid asset status')
    if (updates.vendor && !mongoose.isValidObjectId(updates.vendor)) return fail(res, 400, 'Invalid vendor')
    const asset = await Asset.findById(req.params.id)
    if (!asset) return fail(res, 404, 'Asset not found')
    if (updates.status && updates.status !== asset.status) {
      if (asset.status === 'assigned') return fail(res, 409, 'Issued assets must be returned through their active asset request')
      const previousStatus = asset.status
      Object.assign(asset, updates)
      await asset.save()
      await AssetTransaction.create({ asset: asset._id, actor: req.user._id, action: 'status-changed', note: `${previousStatus} → ${asset.status}` })
    } else {
      Object.assign(asset, updates)
      await asset.save()
    }
    await writeAudit(req.user.id, 'asset.updated', 'asset', asset.id)
    await asset.populate('assignedTo', 'name email')
    res.json({ asset })
  }),
)

app.get(
  '/api/asset-requests',
  authenticate,
  asyncRoute(async (req, res) => {
    const query = {}
    if (req.user.role === 'technician') query.technician = req.user._id
    if (req.user.role === 'employee') return res.json({ requests: [] })
    if (req.user.role === 'asset-manager') query.status = { $in: ['pending', 'approved', 'issued', 'returned', 'rejected'] }
    if (req.user.role === 'it-manager' && req.user.department) {
      const tickets = await Ticket.find({ department: req.user.department }).distinct('_id')
      query.ticket = { $in: tickets }
    }
    const requests = await AssetRequest.find(query)
      .populate('asset', 'name assetTag category status')
      .populate('ticket', 'title status department')
      .populate('technician', 'name email department')
      .populate('reviewedBy', 'name')
      .sort({ requestedAt: -1 })
      .limit(200)
    res.json({ requests })
  }),
)

app.post(
  '/api/tickets/:id/asset-requests',
  authenticate,
  allowRoles('technician'),
  asyncRoute(async (req, res) => {
    const ticket = await Ticket.findById(req.params.id)
    if (!ticket || String(ticket.assignee) !== req.user.id) return fail(res, 403, 'Only the accepted technician can request an asset')
    if (!['assigned', 'in-progress', 'pending-asset'].includes(ticket.status)) return fail(res, 409, 'This ticket is not active')
    if (!mongoose.isValidObjectId(req.body.assetId)) return fail(res, 400, 'Select a valid asset')
    const asset = await Asset.findOne({ _id: req.body.assetId, status: 'available' })
    if (!asset) return fail(res, 409, 'Asset is not currently available')
    const existing = await AssetRequest.exists({ asset: asset._id, status: { $in: ['pending', 'approved', 'issued'] } })
    if (existing) return fail(res, 409, 'Asset already has an active request')
    const request = await AssetRequest.create({
      asset: asset._id,
      activeAsset: asset._id,
      ticket: ticket._id,
      technician: req.user._id,
    })
    ticket.status = 'pending-asset'
    await ticket.save()
    await AssetTransaction.create({ asset: asset._id, ticket: ticket._id, assetRequest: request._id, actor: req.user._id, action: 'requested' })
    const managers = await User.find({ role: 'asset-manager', active: true }).select('_id')
    await Promise.all(managers.map((manager) => notify(manager._id, req.user.id, 'asset.requested', `${req.user.name} requested ${asset.name} for ${ticket.title}`, 'asset-request', request.id)))
    await writeAudit(req.user.id, 'asset.requested', 'asset-request', request.id)
    io.to(`ticket:${ticket.id}`).emit('ticket:updated', { ticketId: ticket.id, status: ticket.status })
    res.status(201).json({ request, ticket })
  }),
)

app.patch(
  '/api/asset-requests/:id/review',
  authenticate,
  allowRoles('asset-manager', 'system-admin'),
  asyncRoute(async (req, res) => {
    if (!['approve', 'reject'].includes(req.body.decision)) return fail(res, 400, 'Decision must be approve or reject')
    if (req.body.decision === 'reject' && (typeof req.body.reason !== 'string' || !req.body.reason.trim())) {
      return fail(res, 400, 'A reason is required when rejecting an asset request')
    }
    const request = await AssetRequest.findOne({ _id: req.params.id, status: 'pending' })
    if (!request) return fail(res, 404, 'Pending asset request not found')
    const ticket = await Ticket.findById(request.ticket)
    if (!ticket || String(ticket.assignee) !== String(request.technician)) return fail(res, 409, 'Request is no longer associated with the active technician')

    request.reviewedBy = req.user._id
    request.reviewedAt = new Date()
    request.reason = req.body.decision === 'reject' ? req.body.reason.trim().slice(0, 1000) : ''
    request.status = req.body.decision === 'approve' ? 'approved' : 'rejected'
    if (request.status === 'rejected') request.activeAsset = undefined
    await request.save()
    await AssetTransaction.create({
      asset: request.asset,
      ticket: request.ticket,
      assetRequest: request._id,
      actor: req.user._id,
      action: request.status,
      note: request.reason,
    })
    await notify(request.technician, req.user.id, `asset.${request.status}`, request.status === 'approved'
      ? 'Your asset request was approved. The asset manager must issue it.'
      : `Your asset request was rejected: ${request.reason}`, 'asset-request', request.id)
    await writeAudit(req.user.id, `asset-request.${request.status}`, 'asset-request', request.id)
    res.json({ request })
  }),
)

app.post(
  '/api/asset-requests/:id/issue',
  authenticate,
  allowRoles('asset-manager', 'system-admin'),
  asyncRoute(async (req, res) => {
    const request = await AssetRequest.findOneAndUpdate(
      { _id: req.params.id, status: 'approved' },
      { $set: { status: 'issued', issuedAt: new Date(), conditionOut: String(req.body.condition || '').slice(0, 500) } },
      { new: true },
    )
    if (!request) return fail(res, 404, 'Approved asset request not found')
    const asset = await Asset.findOneAndUpdate(
      { _id: request.asset, status: 'available' },
      { $set: { status: 'assigned', assignedTo: request.technician } },
      { new: true },
    )
    if (!asset) {
      request.status = 'approved'
      request.issuedAt = null
      await request.save()
      return fail(res, 409, 'Asset is no longer available to issue')
    }
    const ticket = await Ticket.findById(request.ticket)
    if (ticket && ticket.status === 'pending-asset') {
      ticket.status = 'in-progress'
      await ticket.save()
    }
    await AssetTransaction.create({ asset: asset._id, ticket: request.ticket, assetRequest: request._id, actor: req.user._id, action: 'issued', condition: request.conditionOut })
    await notify(request.technician, req.user.id, 'asset.issued', `${asset.name} was issued to you`, 'asset-request', request.id)
    await writeAudit(req.user.id, 'asset.issued', 'asset-request', request.id)
    res.json({ request, asset })
  }),
)

app.post(
  '/api/asset-requests/:id/return',
  authenticate,
  allowRoles('technician'),
  asyncRoute(async (req, res) => {
    if (typeof req.body.condition !== 'string' || !req.body.condition.trim()) {
      return fail(res, 400, 'Describe the returned asset condition')
    }
    const request = await AssetRequest.findOneAndUpdate(
      { _id: req.params.id, technician: req.user._id, status: 'issued' },
      { $set: { status: 'returned', returnedAt: new Date(), conditionIn: req.body.condition.trim().slice(0, 500) }, $unset: { activeAsset: 1 } },
      { new: true },
    )
    if (!request) return fail(res, 404, 'Issued asset request not found')
    const asset = await Asset.findOneAndUpdate(
      { _id: request.asset, status: 'assigned', assignedTo: req.user._id },
      { $set: { status: 'available', assignedTo: null } },
      { new: true },
    )
    if (!asset) {
      request.status = 'issued'
      request.returnedAt = null
      await request.save()
      return fail(res, 409, 'Asset assignment changed; manager review is required')
    }
    await AssetTransaction.create({ asset: asset._id, ticket: request.ticket, assetRequest: request._id, actor: req.user._id, action: 'returned', condition: request.conditionIn })
    await writeAudit(req.user.id, 'asset.returned', 'asset-request', request.id)
    res.json({ request, asset })
  }),
)

app.get(
  '/api/assets/:id/history',
  authenticate,
  allowRoles('system-admin', 'asset-manager', 'it-manager'),
  asyncRoute(async (req, res) => {
    const history = await AssetTransaction.find({ asset: req.params.id })
      .populate('actor', 'name role')
      .populate('ticket', 'title')
      .sort({ createdAt: -1 })
    res.json({ history })
  }),
)

app.get(
  '/api/attachments/:filename',
  authenticate,
  asyncRoute(async (req, res) => {
    const filename = basename(req.params.filename)
    const ticket = await Ticket.findOne({ 'attachments.path': filename })
    if (!ticket) return fail(res, 404, 'Attachment not found')
    const access = await getTicketForUser(ticket.id, req.user)
    if (!access || access === false) return fail(res, 403, 'Attachment access denied')
    const attachment = ticket.attachments.find((item) => item.path === filename)
    if (req.user.role === 'employee' && attachment.uploadedBy && String(attachment.uploadedBy) !== req.user.id) {
      return fail(res, 403, 'Attachment access denied')
    }
    res.download(join('uploads', filename), attachment.name)
  }),
)

app.get(
  '/api/notifications',
  authenticate,
  asyncRoute(async (req, res) => {
    const notifications = await Notification.find({ recipient: req.user._id }).sort({ createdAt: -1 }).limit(100)
    res.json({ notifications })
  }),
)

app.patch(
  '/api/notifications/:id/read',
  authenticate,
  asyncRoute(async (req, res) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { $set: { readAt: new Date() } },
      { new: true },
    )
    if (!notification) return fail(res, 404, 'Notification not found')
    res.json({ notification })
  }),
)

app.patch(
  '/api/notifications/read-all',
  authenticate,
  asyncRoute(async (req, res) => {
    const result = await Notification.updateMany(
      { recipient: req.user._id, readAt: null },
      { $set: { readAt: new Date() } },
    )
    res.json({ updated: result.modifiedCount })
  }),
)

app.get(
  '/api/knowledge',
  authenticate,
  asyncRoute(async (req, res) => {
    const query = { published: true }
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      query.$text = { $search: req.query.q.trim() }
    }
    if (typeof req.query.category === 'string') query.category = req.query.category
    const articles = await KnowledgeArticle.find(query).sort({ updatedAt: -1 }).limit(100)
    res.json({ articles })
  }),
)

app.post(
  '/api/knowledge',
  authenticate,
  allowRoles('system-admin', 'it-manager', 'technician'),
  asyncRoute(async (req, res) => {
    const { title, body, category = 'General', tags = [] } = req.body
    if (typeof title !== 'string' || !title.trim() || typeof body !== 'string' || !body.trim()) {
      return fail(res, 400, 'Article title and body are required')
    }
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string' || tag.length > 50)) {
      return fail(res, 400, 'Tags must be short text values')
    }
    const article = await KnowledgeArticle.create({ title, body, category, tags, createdBy: req.user._id })
    await writeAudit(req.user.id, 'knowledge.created', 'knowledge-article', article.id)
    res.status(201).json({ article })
  }),
)

app.get(
  '/api/vendors',
  authenticate,
  allowRoles('system-admin', 'asset-manager', 'it-manager'),
  asyncRoute(async (req, res) => {
    const vendors = await Vendor.find().sort({ name: 1 }).limit(200)
    res.json({ vendors })
  }),
)

app.post(
  '/api/vendors',
  authenticate,
  allowRoles('system-admin', 'asset-manager'),
  asyncRoute(async (req, res) => {
    if (typeof req.body.name !== 'string' || !req.body.name.trim()) return fail(res, 400, 'Vendor name is required')
    const vendor = await Vendor.create({
      name: req.body.name.trim(),
      email: typeof req.body.email === 'string' ? req.body.email : '',
      phone: typeof req.body.phone === 'string' ? req.body.phone : '',
      notes: typeof req.body.notes === 'string' ? req.body.notes : '',
    })
    await writeAudit(req.user.id, 'vendor.created', 'vendor', vendor.id)
    res.status(201).json({ vendor })
  }),
)

app.get(
  '/api/slas',
  authenticate,
  allowRoles('system-admin', 'it-manager'),
  asyncRoute(async (req, res) => {
    const slas = await SLA.find().sort({ priority: 1 })
    res.json({ slas })
  }),
)

app.put(
  '/api/slas/:priority',
  authenticate,
  allowRoles('system-admin'),
  asyncRoute(async (req, res) => {
    if (!priorities.includes(req.params.priority)) return fail(res, 400, 'Invalid SLA priority')
    const responseMinutes = Number(req.body.responseMinutes)
    const resolutionMinutes = Number(req.body.resolutionMinutes)
    if (!Number.isInteger(responseMinutes) || responseMinutes < 1 || !Number.isInteger(resolutionMinutes) || resolutionMinutes < responseMinutes) {
      return fail(res, 400, 'Resolution minutes must be at least the response minutes')
    }
    const sla = await SLA.findOneAndUpdate(
      { priority: req.params.priority },
      { $set: { responseMinutes, resolutionMinutes, businessHoursOnly: req.body.businessHoursOnly === true } },
      { new: true, upsert: true, runValidators: true },
    )
    await writeAudit(req.user.id, 'sla.updated', 'sla', sla.id)
    res.json({ sla })
  }),
)

app.get(
  '/api/reports/tickets.csv',
  authenticate,
  allowRoles('system-admin', 'it-manager'),
  asyncRoute(async (req, res) => {
    const query = ticketFilterFor(req.user)
    const tickets = await Ticket.find(query).populate('requester', 'name').populate('assignee', 'name').sort({ createdAt: -1 }).limit(5000)
    const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const rows = [
      ['Ticket ID', 'Title', 'Category', 'Priority', 'Status', 'Department', 'Requester', 'Technician', 'Created', 'SLA due'],
      ...tickets.map((ticket) => [
        ticket.id, ticket.title, ticket.category, ticket.priority, ticket.status, ticket.department,
        ticket.requester?.name, ticket.assignee?.name, ticket.createdAt?.toISOString(), ticket.slaDueAt?.toISOString(),
      ]),
    ]
    res.type('text/csv').attachment('servicedesk-tickets.csv').send(rows.map((row) => row.map(csvCell).join(',')).join('\r\n'))
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
  if (error.code === 11000) {
    const field = error.keyPattern?.email ? 'Email' : error.keyPattern?.assetTag ? 'Asset tag' : 'Active asset request'
    return fail(res, 409, `${field} already exists`)
  }
  if (error instanceof multer.MulterError) return fail(res, error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.message)
  if (error.message?.startsWith('Only images, PDF')) return fail(res, 400, error.message)
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
  if (ADMIN_PASSWORD.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters')

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
  await AssetRequest.init()
  await Promise.all([
    SLA.updateOne({ priority: 'critical' }, { $setOnInsert: { responseMinutes: 15, resolutionMinutes: 60, businessHoursOnly: true } }, { upsert: true }),
    SLA.updateOne({ priority: 'high' }, { $setOnInsert: { responseMinutes: 60, resolutionMinutes: 240, businessHoursOnly: true } }, { upsert: true }),
    SLA.updateOne({ priority: 'medium' }, { $setOnInsert: { responseMinutes: 240, resolutionMinutes: 480, businessHoursOnly: true } }, { upsert: true }),
    SLA.updateOne({ priority: 'low' }, { $setOnInsert: { responseMinutes: 480, resolutionMinutes: 1440, businessHoursOnly: true } }, { upsert: true }),
  ])
  const port = Number(process.env.PORT || 4000)
  server.on('request', app)
  server.listen(port, () => console.log(`ServiceDesk API listening on http://localhost:${port}`))
}

start().catch((error) => {
  console.error('Failed to start ServiceDesk API:', error.message)
  process.exitCode = 1
})
