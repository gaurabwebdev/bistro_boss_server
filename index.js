const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
const cors = require("cors");
const jwt = require("jsonwebtoken");
app.use(cors());

// Middlewares
app.use(express.json());
require("dotenv").config();

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }

  // Token structure --- "bearer token"
  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
    if (error) {
      return res
        .status(403)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Cart Amount Calculation
const calculateCartAmount = (items) => {
  return items * 100;
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wqlyhsd.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const database = client.db("bistroBoss");
    const users = database.collection("users");
    const menu = database.collection("menu");
    const reviews = database.collection("reviews");
    const cart = database.collection("cart");
    const paymentConfirmation = database.collection("paymentConfirmation");

    app.get("/", (req, res) => {
      res.send("BISTRO-BOSS Is Here");
    });

    // JWT TOKEN ISSUE
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const jToken = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ jToken });
    });

    // Verify Admin Middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await users.findOne(query);
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }
      next();
    };

    // USER API
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await users.find().toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const currentUser = req.body;
      const existingUser = { email: currentUser.email };
      const isExist = await users.findOne(existingUser);
      if (isExist) {
        return res.send({ message: "User Already Exist" });
      }
      const result = await users.insertOne(currentUser);
      res.send(result);
    });

    // Verify Admin

    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        return res.send({ admin: false });
      }
      const query = { email: email };
      const user = await users.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };

      const result = await users.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await users.deleteOne(query);
      res.send(result);
    });

    // MENU API
    app.get("/menu", async (req, res) => {
      const cursor = menu.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/menu", verifyJWT, verifyAdmin, async (req, res) => {
      const newItem = req.body;
      const result = await menu.insertOne(newItem);
      res.send(result);
    });

    app.delete("/menu/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menu.deleteOne(query);
      res.send(result);
    });

    // REVIEW API
    app.get("/reviews", async (req, res) => {
      const cursor = reviews.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // Cart Collection API

    app.get("/carts", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (!email) {
        return res.send([]);
      } else if (decodedEmail !== email) {
        return res
          .status(403)
          .send({ error: true, message: "Forbidden Access" });
      }
      const query = { email: email };
      const result = await cart.find(query).toArray();
      res.send(result);
    });

    app.post("/carts", async (req, res) => {
      const item = req.body;
      const result = await cart.insertOne(item);
      res.send(result);
    });

    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cart.deleteOne(query);
      res.send(result);
    });

    // Create Payment Intent
    app.post("/create-payment-content", verifyJWT, async (req, res) => {
      const { totalPrice } = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: calculateCartAmount(totalPrice),
        currency: "usd",
        payment_method_types: ["card"],
      });
      console.log(paymentIntent);
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // Payment Record
    app.post("/payment", verifyJWT, async (req, res) => {
      const { payment } = req.body;
      const insertResult = await paymentConfirmation.insertOne(payment);

      const query = {
        _id: { $in: payment.cartProductsId?.map((id) => new ObjectId(id)) },
      };
      const deleteResult = await cart.deleteMany(query);

      res.send({ insertResult, deleteResult });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`BISTRO-BOSS is running on ${port}`);
});

/**
 * ------------------------
 *    Naming Convention
 * ------------------------
 * users : userCollection
 * app.get('/users')
 * app.get('/users/:id')
 * app.post('/users')
 * app.patch('/users/:id')
 * app.put('/users/:id')
 * app.delete('/users/:id')
 */
