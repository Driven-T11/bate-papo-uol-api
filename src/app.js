import cors from "cors"
import express from "express"
import dotenv from "dotenv"
import { MongoClient } from "mongodb"
import Joi from "joi"
import dayjs from "dayjs"
import { stripHtml } from "string-strip-html"

const app = express()

// Configs
app.use(cors())
app.use(express.json())
dotenv.config()

// Conexão DB
const mongoClient = new MongoClient(process.env.DATABASE_URL)

try {
    mongoClient.connect()
    console.log("MongoDB conectado!")
} catch (err) {
    console.log(err.message)
}

const db = mongoClient.db()

// Schemas
const participantSchema = Joi.object({ name: Joi.string().required().trim() })
const messageSchema = Joi.object({
    from: Joi.string().required().trim(),
    to: Joi.string().required().trim(),
    text: Joi.string().required().trim(),
    type: Joi.required().valid("message", "private_message")
})

// Endpoints
app.post("/participants", async (req, res) => {
    const { name } = req.body

    const validation = participantSchema.validate(req.body, { abortEarly: false })
    if (validation.error) {
        return res.status(422).send(validation.error.details.map(detail => detail.message))
    }

    const cleanName = stripHtml(name).result

    try {
        const participant = await db.collection('participants').findOne({ name })
        if (participant) return res.sendStatus(409)

        const timestamp = Date.now()
        await db.collection('participants').insertOne({ name: cleanName, lastStatus: timestamp })

        const message = {
            from: cleanName,
            to: 'Todos',
            text: 'entra na sala...',
            type: 'status',
            time: dayjs(timestamp).format('HH:mm:ss')
        }
        await db.collection('messages').insertOne(message)
        res.sendStatus(201)

    } catch (err) {
        res.status(500).send(err.message)
    }
})

app.get("/participants", async (req, res) => {
    try {
        const participants = await db.collection('participants').find().toArray()
        res.send(participants)
    } catch (err) {
        res.status(500).send(err.message)
    }
})

app.post("/messages", async (req, res) => {
    const { to, text, type } = req.body
    const { user } = req.headers

    const validation = messageSchema.validate({ ...req.body, from: user }, { abortEarly: false })
    if (validation.error) {
        return res.status(422).send(validation.error.details.map(detail => detail.message))
    }

    const name = stripHtml(user).result
    const message = {
        from: name,
        to: stripHtml(to).result,
        text: stripHtml(text).result,
        type: stripHtml(type).result,
        time: dayjs().format('HH:mm:ss')
    }

    try {
        const participant = await db.collection('participants').findOne({ name })
        if (!participant) return res.sendStatus(422)

        await db.collection('messages').insertOne(message)
        res.sendStatus(201)

    } catch (err) {
        res.status(500).send(err.message)
    }
})

app.get("/messages", async (req, res) => {
    const { user } = req.headers
    const { limit } = req.query
    const numLimit = Number(limit)

    if (limit !== undefined && (numLimit <= 0 || isNaN(numLimit))) return res.sendStatus(422)

    try {
        const messages = await db.collection('messages')
            .find({ $or: [{ from: user }, { to: user }, { type: "message" }, { to: "Todos" }] })
            .sort({ $natural: -1 })
            .limit(limit === undefined ? 0 : numLimit)
            .toArray()

        res.send(messages)
    } catch (err) {
        res.status(500).send(err.message)
    }
})

app.post("/status", async (req, res) => {
    const { user } = req.headers

    if (!user) return res.sendStatus(404)

    try {
        // const participant = await db.collection('participants').findOne({ name: user })
        // if (!participant) return res.sendStatus(404)

        const result = await db.collection('participants').updateOne(
            { name: user }, { $set: { lastStatus: Date.now() } }
        )

        if (result.matchedCount === 0) return res.sendStatus(404)

        res.sendStatus(200)
    } catch (err) {
        res.status(500).send(err.message)
    }
})

setInterval(async () => {
    const tenSecondsAgo = Date.now() - 10000

    try {
        const inactiveUsers = await db.collection("participants")
            .find({ lastStatus: { $lt: tenSecondsAgo } })
            .toArray()


        if (inactiveUsers.length > 0) {
            const messages = inactiveUsers.map(user => {
                return {
                    from: user.name,
                    to: 'Todos',
                    text: 'sai da sala...',
                    type: 'status',
                    time: dayjs().format('HH:mm:ss')
                }
            })

            await db.collection('messages').insertMany(messages)
            await db.collection('participants').deleteMany({ lastStatus: { $lt: tenSecondsAgo } })
        }
    } catch (err) {
        console.log(err)
    }
}, 1000)

// Deixa o app escutando, à espera de requisições
const PORT = 5000
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`))