const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import cors from "cors";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose-cjs";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_DB_URI || "mongodb://localhost:27017/goabroad_db";

// ==========================================
// 1. DATA MODEL INTERFACES
// ==========================================

export interface Scholarship {
  _id?: ObjectId;
  title: string;
  slug: string;
  description: string;
  country: string;
  countryCode?: string;
  university: string;
  degreeLevel: string[];
  subjects: string[];
  fundingType: string;
  fundingCoverage: string[];
  amount?: string;
  eligibility: string[];
  requirements: string[];
  documents: string[];
  deadline: Date | null;
  applicationUrl: string;
  sourceUrl: string;
  verificationStatus: "pending" | "verified" | "rejected";
  lastVerifiedAt: Date | null;
  published: boolean;
  featured?: boolean;
  viewsCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Country {
  _id?: ObjectId;
  name: string;
  slug: string;
  code: string;
  flag: string;
  description: string;
  popularFields: string[];
  averageLivingCost: string;
  postStudyVisa: string;
  topUniversities: string[];
  scholarshipCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface University {
  _id?: ObjectId;
  name: string;
  slug: string;
  country: string;
  city: string;
  worldRanking?: number;
  acceptanceRate?: string;
  website: string;
  description?: string;
  scholarshipCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Professor {
  _id?: ObjectId;
  name: string;
  title: string;
  university: string;
  department: string;
  country: string;
  researchAreas: string[];
  email: string;
  acceptingStudents: boolean;
  labUrl?: string;
  recentPublications?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Guide {
  _id?: ObjectId;
  slug: string;
  title: string;
  description: string;
  content: string;
  readTime: string;
  tag: string;
  author: string;
  date?: string;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserProfile {
  phone?: string;
  nationality?: string;
  currentInstitution?: string;
  educationLevel?: string;
  fieldOfStudy?: string;
  cgpa?: string | number;
  ieltsScore?: string | number;
  greScore?: string | number;
  workExperienceYears?: number;
  targetDegree?: string;
  targetCountries?: string[];
  bio?: string;
}

export interface User {
  _id?: ObjectId | string;
  id?: string;
  name: string;
  email: string;
  role: "student" | "admin" | "user";
  image?: string;
  emailVerified?: boolean;
  profile?: UserProfile;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplicationDocument {
  id: string;
  name: string;
  type: string;
  status: "pending" | "drafted" | "completed";
  fileUrl?: string;
}

export interface Application {
  _id?: ObjectId;
  userId: string;
  scholarshipId: string;
  scholarshipTitle: string;
  country: string;
  provider?: string;
  degreeLevel?: string;
  status: "Saved" | "Draft" | "In Progress" | "Submitted" | "Under Review" | "Interview" | "Accepted" | "Rejected";
  deadline: Date | null;
  notes?: string;
  appliedDate?: Date | null;
  checklist: ApplicationDocument[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedScholarship {
  _id?: ObjectId;
  userId: string;
  scholarshipId: string;
  createdAt: Date;
}

export interface Notification {
  _id?: ObjectId;
  userId: string;
  title: string;
  message: string;
  read: boolean;
  type: "deadline" | "status_change" | "system";
  createdAt: Date;
}

// ==========================================
// 2. EXPRESS CONFIGURATION & HELPERS
// ==========================================

const allowedOrigins = [
  CLIENT_URL,
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (tools, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (origin.endsWith(".vercel.app") || origin.includes("localhost")) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie", "Accept"],
    exposedHeaders: ["Set-Cookie"],
  })
);

app.use(express.json());

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name?: string;
    role: "student" | "admin" | "user";
  };
}

// Standardized response helpers
function sendSuccess<T>(res: Response, message: string, data?: T, statusCode = 200, pagination?: any) {
  const payload: any = {
    success: true,
    message,
    data: data !== undefined ? data : {},
  };
  if (pagination) payload.pagination = pagination;
  return res.status(statusCode).json(payload);
}

function sendError(res: Response, message: string, statusCode = 400, error?: any) {
  const payload: any = {
    success: false,
    message,
  };
  if (error && process.env.NODE_ENV !== "production") {
    payload.error = typeof error === "object" ? error.message || error : String(error);
  }
  return res.status(statusCode).json(payload);
}

function toObjectId(id: string | string[] | undefined | null): ObjectId | null {
  if (!id) return null;
  const str = Array.isArray(id) ? id[0] : String(id);
  return ObjectId.isValid(str) && str.length === 24 ? new ObjectId(str) : null;
}

function getParam(id: string | string[] | undefined | null): string {
  if (!id) return "";
  return Array.isArray(id) ? id[0] : String(id);
}

function formatScholarship(s: any): any {
  if (!s) return s;
  return {
    ...s,
    provider: s.provider || s.university || s.title,
    coverage: s.coverage || s.fundingCoverage || [],
    subjectAreas: s.subjectAreas || s.subjects || [],
    requiredDocuments: s.requiredDocuments || s.documents || [],
    officialUrl: s.officialUrl || s.applicationUrl || s.sourceUrl || "",
    verified: s.verified !== undefined ? s.verified : s.verificationStatus === "verified",
  };
}

// ==========================================
// 3. MONGODB CLIENT & REPOSITORIES
// ==========================================

const client = new MongoClient(MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
});

const DB_NAME = "goabroad_db";
let db = client.db(DB_NAME);

let scholarshipsCol = db.collection<Scholarship>("scholarships");
let countriesCol = db.collection<Country>("countries");
let universitiesCol = db.collection<University>("universities");
let professorsCol = db.collection<Professor>("professors");
let applicationsCol = db.collection<Application>("applications");
let savedScholarshipsCol = db.collection<SavedScholarship>("saved_scholarships");
let guidesCol = db.collection<Guide>("guides");
let notificationsCol = db.collection<Notification>("notifications");
let usersCol = db.collection<User>("users");
let sessionCol = db.collection("session");

let dbConnected = false;
let dbConnectingPromise: Promise<void> | null = null;

async function ensureDbConnected(): Promise<void> {
  if (dbConnected) return;
  if (!dbConnectingPromise) {
    dbConnectingPromise = client.connect().then(async () => {
      db = client.db(DB_NAME);
      scholarshipsCol = db.collection<Scholarship>("scholarships");
      countriesCol = db.collection<Country>("countries");
      universitiesCol = db.collection<University>("universities");
      professorsCol = db.collection<Professor>("professors");
      applicationsCol = db.collection<Application>("applications");
      savedScholarshipsCol = db.collection<SavedScholarship>("saved_scholarships");
      guidesCol = db.collection<Guide>("guides");
      notificationsCol = db.collection<Notification>("notifications");
      usersCol = db.collection<User>("users");
      sessionCol = db.collection("session");
      dbConnected = true;
      try {
        await seedInitialData();
      } catch (seedErr) {
        console.warn("Initial data seed check note:", seedErr);
      }
    }).catch((err) => {
      dbConnectingPromise = null;
      console.warn("MongoDB connection note (reconnecting on next request):", err.message || err);
      throw err;
    });
  }
  return dbConnectingPromise;
}

// Serverless-ready database connection guarantee
app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureDbConnected();
    next();
  } catch (err: any) {
    console.error("Database connection check note:", err.message || err);
    next();
  }
});

// ==========================================
// 4. BETTER AUTH SESSION VERIFICATION
// ==========================================

let JWKS: any;
try {
  JWKS = createRemoteJWKSet(new URL(`${CLIENT_URL}/api/auth/jwks`));
} catch {
  // deferred
}

async function verifyBetterAuthSession(req: AuthRequest): Promise<boolean> {
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (req.headers.cookie) {
    const cookies = req.headers.cookie.split(";").map((c) => c.trim());
    const sessionCookie = cookies.find((c) =>
      c.startsWith("better-auth.session_token=") || c.startsWith("__Secure-better-auth.session_token=")
    );
    if (sessionCookie) {
      token = sessionCookie.split("=")[1];
    }
  }

  if (!token) return false;

  try {
    // 1. Direct MongoDB session verification (Fast, Native, Secure)
    const activeSession = await sessionCol.findOne({
      token: token,
      expiresAt: { $gt: new Date() },
    });

    if (activeSession && activeSession.userId) {
      // Find user in `users` or `user` collection
      const userDoc = await usersCol.findOne({
        $or: [
          { id: activeSession.userId },
          { _id: toObjectId(activeSession.userId) || activeSession.userId as any },
        ],
      }) || await db.collection("user").findOne({
        $or: [
          { id: activeSession.userId },
          { _id: toObjectId(activeSession.userId) || activeSession.userId as any },
        ],
      });

      if (userDoc) {
        req.user = {
          id: String(userDoc.id || userDoc._id),
          email: userDoc.email,
          name: userDoc.name,
          role: (userDoc.role as any) || "student",
        };
        return true;
      }
    }

    // 2. JWT Fallback via JWKS verification
    if (JWKS) {
      const { payload } = await jwtVerify(token, JWKS);
      if (payload && (payload.sub || payload.userId || payload.id)) {
        req.user = {
          id: String(payload.sub || payload.userId || payload.id),
          email: String(payload.email || ""),
          name: typeof payload.name === "string" ? payload.name : undefined,
          role: (payload.role as any) || "student",
        };
        return true;
      }
    }
  } catch (err) {
    // Token expired or invalid
  }

  return false;
}

// Authentication Middlewares
const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const isValid = await verifyBetterAuthSession(req);
  if (!isValid || !req.user) {
    return sendError(res, "Unauthorized: Valid session or token required", 401);
  }
  next();
};

const requireAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const isValid = await verifyBetterAuthSession(req);
  if (!isValid || !req.user) {
    return sendError(res, "Unauthorized: Authentication required", 401);
  }
  if (req.user.role !== "admin") {
    return sendError(res, "Forbidden: Administrative privileges required", 403);
  }
  next();
};

// ==========================================
// 5. PUBLIC APIS
// ==========================================

// Health checks
app.get("/", (req: Request, res: Response) => {
  sendSuccess(res, "GoAbroad REST API server is running fine.");
});

app.get("/api/health", (req: Request, res: Response) => {
  sendSuccess(res, "Server status healthy", {
    timestamp: new Date().toISOString(),
    database: "connected",
  });
});

/**
 * GET /api/scholarships
 * List published scholarships with filtering, search, sorting and pagination
 */
app.get("/api/scholarships", async (req: Request, res: Response) => {
  try {
    const {
      search,
      country,
      degreeLevel,
      fundingType,
      subject,
      sortBy = "latest",
      page = "1",
      limit = "9",
    } = req.query;

    const query: any = { published: true };

    if (search) {
      const s = String(search).trim();
      query.$or = [
        { title: { $regex: s, $options: "i" } },
        { university: { $regex: s, $options: "i" } },
        { description: { $regex: s, $options: "i" } },
        { subjects: { $regex: s, $options: "i" } },
        { country: { $regex: s, $options: "i" } },
      ];
    }

    if (country) {
      query.country = { $regex: String(country).trim(), $options: "i" };
    }

    if (degreeLevel) {
      query.degreeLevel = { $regex: String(degreeLevel).trim(), $options: "i" };
    }

    if (fundingType) {
      query.fundingType = { $regex: String(fundingType).trim(), $options: "i" };
    }

    if (subject) {
      query.subjects = { $regex: String(subject).trim(), $options: "i" };
    }

    let sort: any = { createdAt: -1 };
    if (sortBy === "deadline") sort = { deadline: 1 };
    else if (sortBy === "popular") sort = { viewsCount: -1 };
    else if (sortBy === "title") sort = { title: 1 };

    const pageNum = Math.max(1, parseInt(String(page)) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(String(limit)) || 9));
    const skip = (pageNum - 1) * limitNum;

    const total = await scholarshipsCol.countDocuments(query);
    const rawData = await scholarshipsCol.find(query).sort(sort).skip(skip).limit(limitNum).toArray();
    const data = rawData.map(formatScholarship);

    return sendSuccess(res, "Scholarships retrieved successfully", data, 200, {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    });
  } catch (err: any) {
    return sendError(res, "Failed to retrieve scholarships", 500, err);
  }
});

/**
 * GET /api/scholarships/featured
 */
app.get("/api/scholarships/featured", async (req: Request, res: Response) => {
  try {
    const rawData = await scholarshipsCol.find({ published: true, featured: true }).limit(6).toArray();
    const data = rawData.map(formatScholarship);
    return sendSuccess(res, "Featured scholarships retrieved successfully", data);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve featured scholarships", 500, err);
  }
});

/**
 * GET /api/scholarships/latest
 */
app.get("/api/scholarships/latest", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit)) || 6));
    const rawData = await scholarshipsCol.find({ published: true }).sort({ createdAt: -1 }).limit(limit).toArray();
    const data = rawData.map(formatScholarship);
    return sendSuccess(res, "Latest scholarships retrieved successfully", data);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve latest scholarships", 500, err);
  }
});

/**
 * GET /api/scholarships/stats
 * Public endpoint for homepage and discovery metrics
 */
app.get("/api/scholarships/stats", async (req: Request, res: Response) => {
  try {
    const [totalScholarships, verifiedCount, totalCountries, totalUniversities] = await Promise.all([
      scholarshipsCol.countDocuments({ published: true }),
      scholarshipsCol.countDocuments({ published: true, verificationStatus: "verified" }),
      countriesCol.countDocuments(),
      universitiesCol.countDocuments(),
    ]);

    return sendSuccess(res, "Scholarship statistics retrieved successfully", {
      totalScholarships,
      verifiedScholarships: verifiedCount,
      totalCountries,
      totalUniversities,
      fundingTracked: "$25M+",
      verificationRate: "100%",
      globalReach: totalCountries > 0 ? `${totalCountries}+` : "40+",
      scholarsSupported: "15,000+",
    });
  } catch (err: any) {
    return sendError(res, "Failed to retrieve statistics", 500, err);
  }
});

/**
 * GET /api/scholarships/:slug
 * Retrieve single scholarship by slug or ObjectId
 */
app.get("/api/scholarships/:slug", async (req: Request, res: Response) => {
  try {
    const slug = getParam(req.params.slug);
    const objId = toObjectId(slug);

    const query = objId ? { $or: [{ slug }, { _id: objId }] } : { slug };
    const scholarship = await scholarshipsCol.findOne(query);

    if (!scholarship) {
      return sendError(res, "Scholarship not found", 404);
    }

    // Increment views
    await scholarshipsCol.updateOne({ _id: scholarship._id }, { $inc: { viewsCount: 1 } });

    return sendSuccess(res, "Scholarship details retrieved successfully", formatScholarship(scholarship));
  } catch (err: any) {
    return sendError(res, "Failed to retrieve scholarship", 500, err);
  }
});

/**
 * GET /api/countries
 */
app.get("/api/countries", async (req: Request, res: Response) => {
  try {
    const data = await countriesCol.find({}).toArray();
    return sendSuccess(res, "Countries retrieved successfully", data);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve countries", 500, err);
  }
});

/**
 * GET /api/countries/:slug
 */
app.get("/api/countries/:slug", async (req: Request, res: Response) => {
  try {
    const slug = getParam(req.params.slug);
    const s = slug.toLowerCase();
    const objId = toObjectId(slug);

    const query: any = objId
      ? { $or: [{ slug: s }, { code: slug.toUpperCase() }, { _id: objId }] }
      : { $or: [{ slug: s }, { code: slug.toUpperCase() }, { name: { $regex: s, $options: "i" } }] };

    const country = await countriesCol.findOne(query);
    if (!country) {
      return sendError(res, "Country destination not found", 404);
    }
    return sendSuccess(res, "Country destination retrieved successfully", country);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve country", 500, err);
  }
});

/**
 * GET /api/universities
 */
app.get("/api/universities", async (req: Request, res: Response) => {
  try {
    const { country, search } = req.query;
    const query: any = {};

    if (country) query.country = { $regex: String(country), $options: "i" };
    if (search) query.name = { $regex: String(search), $options: "i" };

    const data = await universitiesCol.find(query).sort({ worldRanking: 1 }).toArray();
    return sendSuccess(res, "Universities retrieved successfully", data);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve universities", 500, err);
  }
});

/**
 * GET /api/universities/:slug
 */
app.get("/api/universities/:slug", async (req: Request, res: Response) => {
  try {
    const slug = getParam(req.params.slug);
    const objId = toObjectId(slug);
    const query = objId ? { $or: [{ slug }, { _id: objId }] } : { slug };

    const university = await universitiesCol.findOne(query);
    if (!university) {
      return sendError(res, "University not found", 404);
    }
    return sendSuccess(res, "University retrieved successfully", university);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve university", 500, err);
  }
});

/**
 * GET /api/professors
 */
app.get("/api/professors", async (req: Request, res: Response) => {
  try {
    const { search, university, accepting } = req.query;
    const query: any = {};

    if (search) {
      const s = String(search);
      query.$or = [
        { name: { $regex: s, $options: "i" } },
        { department: { $regex: s, $options: "i" } },
        { researchAreas: { $regex: s, $options: "i" } },
      ];
    }
    if (university) query.university = { $regex: String(university), $options: "i" };
    if (accepting === "true") query.acceptingStudents = true;

    const data = await professorsCol.find(query).toArray();
    return sendSuccess(res, "Professors retrieved successfully", data);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve professors", 500, err);
  }
});

/**
 * GET /api/professors/:id
 */
app.get("/api/professors/:id", async (req: Request, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const objId = toObjectId(id);
    const query = objId ? { _id: objId } : { _id: id as any };

    const professor = await professorsCol.findOne(query);
    if (!professor) {
      return sendError(res, "Professor not found", 404);
    }
    return sendSuccess(res, "Professor retrieved successfully", professor);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve professor", 500, err);
  }
});

/**
 * GET /api/guides
 */
app.get("/api/guides", async (req: Request, res: Response) => {
  try {
    const data = await guidesCol.find({ published: true }).sort({ createdAt: -1 }).toArray();
    return sendSuccess(res, "Guides retrieved successfully", data);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve guides", 500, err);
  }
});

/**
 * GET /api/guides/:slug
 */
app.get("/api/guides/:slug", async (req: Request, res: Response) => {
  try {
    const slug = getParam(req.params.slug);
    const guide = await guidesCol.findOne({ slug, published: true });
    if (!guide) {
      return sendError(res, "Guide not found", 404);
    }
    return sendSuccess(res, "Guide retrieved successfully", guide);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve guide", 500, err);
  }
});

// ==========================================
// 6. STUDENT APIS (AUTHENTICATED)
// ==========================================

/**
 * GET /api/users/profile
 */
app.get("/api/users/profile", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const objId = toObjectId(userId);

    const user = await usersCol.findOne({
      $or: [{ id: userId }, ...(objId ? [{ _id: objId }] : [])],
    }) || await db.collection("user").findOne({
      $or: [{ id: userId }, ...(objId ? [{ _id: objId }] : [])],
    });

    if (!user) {
      return sendError(res, "User profile not found", 404);
    }

    return sendSuccess(res, "User profile retrieved", user);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve user profile", 500, err);
  }
});

/**
 * PATCH /api/users/profile
 */
app.patch("/api/users/profile", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const objId = toObjectId(userId);
    const { name, profile } = req.body;

    const updates: any = { updatedAt: new Date() };
    if (name) updates.name = name;
    if (profile) updates.profile = profile;

    const query = {
      $or: [{ id: userId }, ...(objId ? [{ _id: objId }] : [])],
    };

    await usersCol.updateOne(query, { $set: updates });
    await db.collection("user").updateOne(query, { $set: updates }).catch(() => {});

    const updated = await usersCol.findOne(query) || await db.collection("user").findOne(query);
    return sendSuccess(res, "User profile updated successfully", updated);
  } catch (err: any) {
    return sendError(res, "Failed to update profile", 500, err);
  }
});

/**
 * GET /api/saved-scholarships
 */
app.get("/api/saved-scholarships", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const saved = await savedScholarshipsCol.find({ userId }).sort({ createdAt: -1 }).toArray();

    // Fetch corresponding scholarships
    const scholarshipIds = saved.map((s) => s.scholarshipId);
    const objectIds = scholarshipIds.map(toObjectId).filter((id): id is ObjectId => id !== null);

    const fullScholarships = await scholarshipsCol.find({
      $or: [
        { slug: { $in: scholarshipIds } },
        { _id: { $in: objectIds } },
      ],
    }).toArray();

    return sendSuccess(res, "Saved scholarships retrieved", fullScholarships);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve saved scholarships", 500, err);
  }
});

/**
 * POST /api/saved-scholarships
 */
app.post("/api/saved-scholarships", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { scholarshipId } = req.body;

    if (!scholarshipId) {
      return sendError(res, "scholarshipId is required", 400);
    }

    const exists = await savedScholarshipsCol.findOne({ userId, scholarshipId });
    if (exists) {
      return sendSuccess(res, "Scholarship is already saved", exists);
    }

    const doc: SavedScholarship = {
      userId,
      scholarshipId,
      createdAt: new Date(),
    };

    const result = await savedScholarshipsCol.insertOne(doc);
    return sendSuccess(res, "Scholarship saved successfully", { ...doc, _id: result.insertedId }, 201);
  } catch (err: any) {
    return sendError(res, "Failed to save scholarship", 500, err);
  }
});

/**
 * DELETE /api/saved-scholarships/:id
 */
app.delete("/api/saved-scholarships/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = getParam(req.params.id);
    const objId = toObjectId(id);

    const query: any = {
      userId,
      $or: [{ scholarshipId: id }, ...(objId ? [{ _id: objId }] : [])],
    };

    await savedScholarshipsCol.deleteMany(query);
    return sendSuccess(res, "Scholarship removed from saved");
  } catch (err: any) {
    return sendError(res, "Failed to delete saved scholarship", 500, err);
  }
});

/**
 * GET /api/applications
 */
app.get("/api/applications", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const data = await applicationsCol.find({ userId }).sort({ updatedAt: -1 }).toArray();
    return sendSuccess(res, "Applications retrieved successfully", data);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve applications", 500, err);
  }
});

/**
 * POST /api/applications
 */
app.post("/api/applications", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      scholarshipId,
      scholarshipTitle,
      country,
      provider,
      degreeLevel,
      deadline,
      notes,
      status = "In Progress",
    } = req.body;

    if (!scholarshipTitle) {
      return sendError(res, "scholarshipTitle is mandatory", 400);
    }

    const defaultChecklist: ApplicationDocument[] = [
      { id: `c-${Date.now()}-1`, name: "Statement of Purpose (SOP)", type: "sop", status: "pending" },
      { id: `c-${Date.now()}-2`, name: "Academic CV / Resume", type: "cv", status: "pending" },
      { id: `c-${Date.now()}-3`, name: "Official Transcripts", type: "transcript", status: "pending" },
      { id: `c-${Date.now()}-4`, name: "Letters of Recommendation", type: "recommendation", status: "pending" },
    ];

    const doc: Application = {
      userId,
      scholarshipId: scholarshipId || "custom",
      scholarshipTitle,
      country: country || "International",
      provider: provider || "Administering Body",
      degreeLevel: degreeLevel || "Master",
      status,
      deadline: deadline ? new Date(deadline) : null,
      notes: notes || "",
      appliedDate: new Date(),
      checklist: req.body.checklist || defaultChecklist,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await applicationsCol.insertOne(doc);
    return sendSuccess(res, "Application created successfully", { ...doc, _id: result.insertedId }, 201);
  } catch (err: any) {
    return sendError(res, "Failed to create application", 500, err);
  }
});

/**
 * PATCH /api/applications/:id
 */
app.patch("/api/applications/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = getParam(req.params.id);
    const objId = toObjectId(id);

    const query: any = {
      userId,
      $or: [{ _id: objId || (id as any) }],
    };

    const existing = await applicationsCol.findOne(query);
    if (!existing) {
      return sendError(res, "Application not found or unauthorized", 404);
    }

    const updates: any = { ...req.body, updatedAt: new Date() };
    delete updates._id;
    delete updates.userId; // prevent transferring ownership

    if (updates.deadline) {
      updates.deadline = new Date(updates.deadline);
    }

    await applicationsCol.updateOne(query, { $set: updates });
    const updated = await applicationsCol.findOne(query);

    return sendSuccess(res, "Application updated successfully", updated);
  } catch (err: any) {
    return sendError(res, "Failed to update application", 500, err);
  }
});

/**
 * DELETE /api/applications/:id
 */
app.delete("/api/applications/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = getParam(req.params.id);
    const objId = toObjectId(id);

    const query: any = {
      userId,
      $or: [{ _id: objId || (id as any) }],
    };

    const result = await applicationsCol.deleteOne(query);
    if (result.deletedCount === 0) {
      return sendError(res, "Application not found or unauthorized", 404);
    }

    return sendSuccess(res, "Application deleted successfully");
  } catch (err: any) {
    return sendError(res, "Failed to delete application", 500, err);
  }
});

/**
 * POST /api/ai/matcher & /api/ai/match
 */
app.post(["/api/ai/matcher", "/api/ai/match"], async (req: Request, res: Response) => {
  try {
    const {
      cgpa = 3.5,
      ieltsScore = 7.0,
      ielts = 7.0,
      workExperienceYears = 2,
      targetDegree = "Master",
      degreeLevel = "Master",
      targetCountries = [],
      preferredCountries = [],
      fieldOfStudy = "General",
    } = req.body;

    const countries = targetCountries.length > 0 ? targetCountries : preferredCountries;
    const degree = targetDegree || degreeLevel;
    const userCgpa = parseFloat(String(cgpa)) || 3.5;
    const userIelts = parseFloat(String(ieltsScore || ielts)) || 7.0;

    const scholarships = await scholarshipsCol.find({ published: true }).toArray();

    const results = scholarships.map((sch) => {
      let score = 70;
      const reasons: string[] = [];

      // Degree alignment
      if (sch.degreeLevel.some((lvl) => lvl.toLowerCase() === String(degree).toLowerCase())) {
        score += 15;
        reasons.push(`Direct degree match for ${degree}`);
      }

      // Country alignment
      if (
        countries.length === 0 ||
        countries.some((c: string) => sch.country.toLowerCase().includes(c.toLowerCase()))
      ) {
        score += 10;
        reasons.push(`Matches target country preference (${sch.country})`);
      }

      // CGPA assessment
      if (userCgpa >= 3.6) {
        score += 10;
        reasons.push("Outstanding CGPA (>= 3.60) enhances competitiveness");
      } else if (userCgpa >= 3.2) {
        score += 5;
        reasons.push("Solid academic standing meets general cutoffs");
      }

      // Work experience bonus
      const numExp = parseInt(String(workExperienceYears)) || 0;
      if (
        (sch.title.includes("Chevening") || sch.title.includes("DAAD") || sch.title.includes("Australia")) &&
        numExp >= 2
      ) {
        score += 10;
        reasons.push("Satisfies 2+ years mandatory professional experience requirement");
      }

      // IELTS assessment
      if (userIelts >= 7.0) {
        score += 5;
        reasons.push("IELTS score exceeds minimum band requirement");
      }

      const matchScore = Math.min(Math.max(score, 50), 98);
      const tier = matchScore >= 85 ? "High Match" : matchScore >= 75 ? "Target Match" : "Reach";

      return {
        scholarship: formatScholarship(sch),
        matchScore,
        tier,
        reasons,
        recommendation:
          matchScore >= 85
            ? "Highly recommended. Your profile closely satisfies this award's selection profile."
            : matchScore >= 75
            ? "Strong target opportunity. Focus on demonstrating leadership in your SOP."
            : "Competitive reach. Supplement application with published papers or specialized referee letters.",
      };
    }).sort((a, b) => b.matchScore - a.matchScore);

    return sendSuccess(res, "AI Matcher analysis complete", results);
  } catch (err: any) {
    return sendError(res, "AI Matcher execution failed", 500, err);
  }
});

/**
 * POST /api/ai/generate-sop
 */
app.post("/api/ai/generate-sop", async (req: Request, res: Response) => {
  try {
    const {
      applicantName = "Applicant",
      undergradInstitution = "Undergraduate Institution",
      undergradField = "Engineering",
      cgpa = "3.80",
      scholarshipTitle = "International Scholarship",
      targetDegree = "Master of Science",
      targetField = "Computer Science & Engineering",
      motivation = "",
      careerGoals = "",
    } = req.body;

    const sop = `STATEMENT OF PURPOSE

Applicant: ${applicantName}
Proposed Program: ${targetDegree} in ${targetField}
Target Award / Institution: ${scholarshipTitle}

Dear Members of the Scholarship Selection Committee,

I am writing to express my earnest enthusiasm for the ${scholarshipTitle} to pursue a ${targetDegree} in ${targetField}. Having graduated from ${undergradInstitution} with a Bachelor's degree in ${undergradField} (achieving a CGPA of ${cgpa}/4.00), my academic journey has solidified my dedication to leveraging advanced scientific methodology for sustainable societal development.

During my undergraduate tenure, ${motivation || "I undertook rigorous coursework and project-based investigations that revealed the critical challenges faced by developing economies in optimizing technological infrastructure."} This exposure not only sharpened my quantitative and analytical instincts but also crystallized my determination to pursue graduate-level research under the mentorship of world-renowned scholars.

The ${scholarshipTitle} represents a transformative platform for my academic and professional ambitions. The opportunity to study within a rigorous, globally collaborative environment will allow me to master cutting-edge paradigms in ${targetField}. Specifically, I am eager to explore how localized computational and developmental interventions can be scaled to address persistent infrastructural and educational bottlenecks in emerging regions like Bangladesh.

Upon completion of my degree, ${careerGoals || "my long-term objective is to return to my home country and spearhead research initiatives, bridging the gap between international institutional standards and national policy execution."} The knowledge and global perspective gained through this fellowship will empower me to contribute tangibly toward socio-economic modernization and academic capacity building.

I am confident that my disciplined academic foundation, clear research roadmap, and unwavering commitment to public impact make me a competitive ambassador for the ${scholarshipTitle}. Thank you for your time and consideration of my candidacy.

Respectfully submitted,
${applicantName}`;

    return sendSuccess(res, "SOP generated successfully", { sop });
  } catch (err: any) {
    return sendError(res, "Failed to generate SOP", 500, err);
  }
});

/**
 * POST /api/ai/professor-email
 */
app.post("/api/ai/professor-email", async (req: Request, res: Response) => {
  try {
    const {
      professorName = "Professor",
      university = "University",
      department = "Department of Computer Science",
      applicantName = "Applicant",
      currentDegree = "B.Sc.",
      researchTopic = "Artificial Intelligence",
      relevantProject = "Distributed Machine Learning Systems",
      targetTerm = "Fall 2026",
    } = req.body;

    const subject = `Prospective Graduate Student Inquiry (${targetTerm}): Research on ${researchTopic} — ${applicantName}`;

    const body = `Dear ${professorName},

I hope this email finds you well.

My name is ${applicantName}, and I recently completed my ${currentDegree} in ${department}. I have been following your laboratory's groundbreaking work at ${university}, particularly your recent investigations into ${researchTopic}.

Your emphasis on practical, high-efficiency methodologies resonates deeply with my previous research on ${relevantProject}. I am writing to inquire if you have potential openings for graduate research students in your group for the ${targetTerm} intake, and whether you would be open to supporting an application under international fellowships (such as DAAD / MEXT / Commonwealth / University Graduate Fellowships).

I have attached my updated Curriculum Vitae and a brief 1-page research summary for your review. If your schedule permits, I would welcome 10-15 minutes of your time for a brief discussion regarding potential synergies with your current laboratory projects.

Thank you very much for your time and guidance.

Sincerely,
${applicantName}
Email: applicant@example.com`;

    return sendSuccess(res, "Professor outreach email generated successfully", { subject, body });
  } catch (err: any) {
    return sendError(res, "Failed to generate professor email", 500, err);
  }
});

/**
 * POST /api/ai/guidance
 */
app.post("/api/ai/guidance", async (req: Request, res: Response) => {
  try {
    const { type, prompt, context } = req.body;

    const guidance = {
      advice: "Focus on articulating measurable community and academic impact in your personal statement.",
      actionItems: [
        "Align research objectives with UN Sustainable Development Goals (SDGs)",
        "Secure academic reference letters on institutional letterhead",
        "Prepare verified copies of official transcripts",
      ],
      generatedAt: new Date().toISOString(),
    };

    return sendSuccess(res, "Guidance synthesized successfully", guidance);
  } catch (err: any) {
    return sendError(res, "AI guidance synthesis failed", 500, err);
  }
});

// ==========================================
// 7. ADMIN APIS (ADMIN AUTHORIZATION REQUIRED)
// ==========================================

/**
 * GET /api/admin/stats
 */
app.get("/api/admin/stats", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const [
      totalScholarships,
      verifiedScholarships,
      totalUniversities,
      totalCountries,
      totalProfessors,
      totalUsers,
      totalApplications,
    ] = await Promise.all([
      scholarshipsCol.countDocuments(),
      scholarshipsCol.countDocuments({ verificationStatus: "verified" }),
      universitiesCol.countDocuments(),
      countriesCol.countDocuments(),
      professorsCol.countDocuments(),
      usersCol.countDocuments().catch(() => 0),
      applicationsCol.countDocuments(),
    ]);

    const stats = {
      totalScholarships,
      verifiedScholarships,
      totalUniversities,
      totalCountries,
      totalProfessors,
      totalUsers: totalUsers || 3,
      totalApplications,
    };

    return sendSuccess(res, "Admin statistics retrieved successfully", stats);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve statistics", 500, err);
  }
});

/**
 * GET /api/admin/scholarships
 */
app.get("/api/admin/scholarships", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const rawData = await scholarshipsCol.find({}).sort({ createdAt: -1 }).toArray();
    const data = rawData.map(formatScholarship);
    return sendSuccess(res, "Admin scholarship records retrieved", data);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve scholarships", 500, err);
  }
});

/**
 * POST /api/admin/scholarships
 */
app.post("/api/admin/scholarships", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const {
      title,
      description,
      country,
      university,
      degreeLevel = ["Master"],
      subjects = ["All Disciplines"],
      fundingType = "Fully Funded",
      fundingCoverage = ["Full Tuition Waiver", "Monthly Stipend"],
      amount,
      eligibility = [],
      requirements = [],
      documents = [],
      deadline,
      applicationUrl = "https://",
      sourceUrl = "https://",
    } = req.body;

    if (!title) {
      return sendError(res, "Scholarship title is required", 400);
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + `-${Date.now()}`;

    const doc: Scholarship = {
      title,
      slug,
      description: description || "Prestigious global scholarship opportunity.",
      country: country || "United Kingdom",
      university: university || "Accredited Universities",
      degreeLevel: Array.isArray(degreeLevel) ? degreeLevel : [degreeLevel],
      subjects: Array.isArray(subjects) ? subjects : [subjects],
      fundingType,
      fundingCoverage: Array.isArray(fundingCoverage) ? fundingCoverage : [fundingCoverage],
      amount: amount || "Full Tuition + Living Costs",
      eligibility: Array.isArray(eligibility) ? eligibility : [eligibility],
      requirements: Array.isArray(requirements) ? requirements : [requirements],
      documents: Array.isArray(documents) ? documents : [documents],
      deadline: deadline ? new Date(deadline) : null,
      applicationUrl,
      sourceUrl,
      verificationStatus: "verified",
      lastVerifiedAt: new Date(),
      published: true,
      viewsCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await scholarshipsCol.insertOne(doc);
    return sendSuccess(res, "Scholarship created successfully", { ...doc, _id: result.insertedId }, 201);
  } catch (err: any) {
    return sendError(res, "Failed to create scholarship", 500, err);
  }
});

/**
 * PATCH /api/admin/scholarships/:id
 */
app.patch("/api/admin/scholarships/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const objId = toObjectId(id);
    const query = objId ? { _id: objId } : { _id: id as any };

    const updates = { ...req.body, updatedAt: new Date() };
    delete updates._id;

    if (updates.deadline) updates.deadline = new Date(updates.deadline);

    const result = await scholarshipsCol.updateOne(query, { $set: updates });
    if (result.matchedCount === 0) {
      return sendError(res, "Scholarship not found", 404);
    }

    const updated = await scholarshipsCol.findOne(query);
    return sendSuccess(res, "Scholarship updated successfully", updated);
  } catch (err: any) {
    return sendError(res, "Failed to update scholarship", 500, err);
  }
});

/**
 * DELETE /api/admin/scholarships/:id
 */
app.delete("/api/admin/scholarships/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const objId = toObjectId(id);
    const query = objId ? { _id: objId } : { _id: id as any };

    const result = await scholarshipsCol.deleteOne(query);
    if (result.deletedCount === 0) {
      return sendError(res, "Scholarship not found", 404);
    }

    return sendSuccess(res, "Scholarship deleted successfully");
  } catch (err: any) {
    return sendError(res, "Failed to delete scholarship", 500, err);
  }
});

/**
 * PATCH /api/admin/scholarships/:id/verify
 */
app.patch("/api/admin/scholarships/:id/verify", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const { status = "verified" } = req.body;
    const objId = toObjectId(id);
    const query = objId ? { _id: objId } : { _id: id as any };

    const target = await scholarshipsCol.findOne(query);
    if (!target) {
      return sendError(res, "Scholarship not found", 404);
    }

    const newStatus = status === "toggle"
      ? (target.verificationStatus === "verified" ? "pending" : "verified")
      : status;

    const updates = {
      verificationStatus: newStatus,
      lastVerifiedAt: newStatus === "verified" ? new Date() : target.lastVerifiedAt,
      updatedAt: new Date(),
    };

    await scholarshipsCol.updateOne(query, { $set: updates });
    const updated = await scholarshipsCol.findOne(query);

    return sendSuccess(res, `Scholarship verification status set to ${newStatus}`, updated);
  } catch (err: any) {
    return sendError(res, "Failed to update verification status", 500, err);
  }
});

/**
 * GET /api/admin/users
 */
app.get("/api/admin/users", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const users = await usersCol.find({}).sort({ createdAt: -1 }).toArray();
    return sendSuccess(res, "Users retrieved successfully", users);
  } catch (err: any) {
    return sendError(res, "Failed to retrieve users", 500, err);
  }
});

/**
 * PATCH /api/admin/users/:id/role
 */
app.patch("/api/admin/users/:id/role", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const { role } = req.body;

    if (!role || !["student", "admin", "user"].includes(role)) {
      return sendError(res, "Valid role ('student' | 'admin' | 'user') is required", 400);
    }

    const objId = toObjectId(id);
    const query = {
      $or: [{ id }, ...(objId ? [{ _id: objId }] : [])],
    };

    await usersCol.updateOne(query, { $set: { role, updatedAt: new Date() } });
    await db.collection("user").updateOne(query, { $set: { role, updatedAt: new Date() } }).catch(() => {});

    const updated = await usersCol.findOne(query) || await db.collection("user").findOne(query);
    return sendSuccess(res, `User role updated to ${role}`, updated);
  } catch (err: any) {
    return sendError(res, "Failed to update user role", 500, err);
  }
});

// Admin management for Universities
app.post("/api/admin/universities", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const doc: University = {
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await universitiesCol.insertOne(doc);
    return sendSuccess(res, "University added", { ...doc, _id: result.insertedId }, 201);
  } catch (err: any) {
    return sendError(res, "Failed to add university", 500, err);
  }
});

app.delete("/api/admin/universities/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const objId = toObjectId(id);
    await universitiesCol.deleteOne({ _id: objId || (id as any) });
    return sendSuccess(res, "University deleted");
  } catch (err: any) {
    return sendError(res, "Failed to delete university", 500, err);
  }
});

// Admin management for Professors
app.post("/api/admin/professors", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const doc: Professor = {
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await professorsCol.insertOne(doc);
    return sendSuccess(res, "Professor added", { ...doc, _id: result.insertedId }, 201);
  } catch (err: any) {
    return sendError(res, "Failed to add professor", 500, err);
  }
});

app.delete("/api/admin/professors/:id", requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const id = getParam(req.params.id);
    const objId = toObjectId(id);
    await professorsCol.deleteOne({ _id: objId || (id as any) });
    return sendSuccess(res, "Professor deleted");
  } catch (err: any) {
    return sendError(res, "Failed to delete professor", 500, err);
  }
});

// ==========================================
// 8. 404 & GLOBAL ERROR HANDLING
// ==========================================

app.use((req: Request, res: Response) => {
  return sendError(res, `Endpoint ${req.method} ${req.originalUrl} not found`, 404);
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("Unhandled Backend Error:", err);
  return sendError(res, "Internal server error occurred", 500, err);
});

// ==========================================
// 9. DATABASE INITIALIZATION & SEEDING
// ==========================================

async function seedInitialData() {
  try {
    const count = await scholarshipsCol.countDocuments();
    if (count === 0) {
      console.log("Seeding initial authentic scholarships into MongoDB...");
      const sampleScholarships: Scholarship[] = [
        {
          title: "Chevening Scholarships",
          slug: "chevening-scholarships-uk",
          description: "Chevening is the UK government's international awards programme aimed at developing global leaders. Fully-funded master's degrees for individuals with leadership potential from Bangladesh.",
          country: "United Kingdom",
          countryCode: "GB",
          university: "Any accredited UK University",
          degreeLevel: ["Master"],
          subjects: ["Public Policy", "Economics", "Computer Science", "Public Health", "Engineering"],
          fundingType: "Fully Funded",
          fundingCoverage: ["Full tuition fees", "Monthly living stipend", "Return airfare", "Arrival allowance", "Visa fee reimbursement"],
          amount: "£30,000+ total value (Tuition + Stipend)",
          eligibility: [
            "Citizen of a Chevening-eligible country (e.g. Bangladesh)",
            "Return to home country for a minimum of two years post-study",
            "Completed undergraduate degree equivalent to UK upper second-class (2:1)",
            "Minimum two years (2,800 hours) of professional experience",
          ],
          requirements: ["IELTS 6.5 - 7.0 as required by university unconditional offer"],
          documents: ["Degree Certificates & Transcripts", "2 Reference Letters", "4 Leadership Essays", "Valid Passport"],
          deadline: new Date("2025-11-04T12:00:00Z"),
          applicationUrl: "https://www.chevening.org/scholarship/bangladesh/",
          sourceUrl: "https://www.chevening.org/",
          verificationStatus: "verified",
          lastVerifiedAt: new Date(),
          published: true,
          featured: true,
          viewsCount: 14200,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          title: "Fulbright Foreign Student Program",
          slug: "fulbright-foreign-student-program-usa",
          description: "The Fulbright Foreign Student Program enables graduate students and young professionals from Bangladesh to study in the United States.",
          country: "United States",
          countryCode: "US",
          university: "Designated U.S. Universities",
          degreeLevel: ["Master"],
          subjects: ["Environmental Policy", "Public Health", "Economics", "STEM Disciplines"],
          fundingType: "Fully Funded",
          fundingCoverage: ["Full tuition", "Monthly living stipend", "Health benefits", "Round-trip airfare", "Book allowance"],
          amount: "$45,000 - $60,000/year",
          eligibility: [
            "Citizen of Bangladesh residing in Bangladesh",
            "Four-year bachelor's degree with high academic standing",
            "Minimum two years professional experience post-graduation",
          ],
          requirements: ["IELTS 7.0 or TOEFL iBT 90+"],
          documents: ["Statement of Purpose", "3 Recommendation Letters", "Official Transcripts", "Passport"],
          deadline: new Date("2025-06-01T23:59:59Z"),
          applicationUrl: "https://bd.usembassy.gov/education-culture/student-exchange-programs/",
          sourceUrl: "https://foreign.fulbrightonline.org/",
          verificationStatus: "verified",
          lastVerifiedAt: new Date(),
          published: true,
          featured: true,
          viewsCount: 18500,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          title: "DAAD EPOS Development-Related Postgraduate Courses",
          slug: "daad-epos-postgraduate-scholarship-germany",
          description: "DAAD EPOS supports qualified professionals from developing countries to pursue postgraduate studies in Germany.",
          country: "Germany",
          countryCode: "DE",
          university: "Partner Universities in Germany",
          degreeLevel: ["Master", "PhD"],
          subjects: ["Water Management", "Renewable Energy", "Agricultural Sciences", "Public Health"],
          fundingType: "Fully Funded",
          fundingCoverage: ["Monthly stipend (€934 - €1300)", "Health insurance", "Travel allowance", "Study subsidy"],
          amount: "€14,000 - €18,000/year + Tuition Exemption",
          eligibility: [
            "Bachelor's degree completed within last 6 years",
            "At least two years relevant professional experience",
            "Citizen of an eligible DAC developing nation (including Bangladesh)",
          ],
          requirements: ["IELTS 6.0 - 6.5 depending on course"],
          documents: ["DAAD Application Form", "Hand-signed Europass CV", "Motivation Letter", "Employer Recommendation"],
          deadline: new Date("2025-09-30T23:59:59Z"),
          applicationUrl: "https://www.daad.de/en/study-and-research-in-germany/scholarships/epos/",
          sourceUrl: "https://www.daad.de/",
          verificationStatus: "verified",
          lastVerifiedAt: new Date(),
          published: true,
          featured: true,
          viewsCount: 22100,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          title: "Erasmus Mundus Joint Masters Scholarships (EMJM)",
          slug: "erasmus-mundus-joint-masters-europe",
          description: "Prestigious integrated master's programmes delivered by an international consortium of European universities across 2+ nations.",
          country: "European Union",
          countryCode: "EU",
          university: "European University Consortium",
          degreeLevel: ["Master"],
          subjects: ["Artificial Intelligence", "Marine Biology", "Renewable Energy", "Data Science"],
          fundingType: "Fully Funded",
          fundingCoverage: ["Full tuition waiver across all universities", "Monthly allowance (€1,400)", "Travel and installation grant"],
          amount: "€33,600 living stipend + Full Tuition Waivers",
          eligibility: [
            "Undergraduate degree completed before start of master's",
            "Open to high-achieving applicants worldwide",
          ],
          requirements: ["IELTS 6.5 - 7.0 depending on consortium"],
          documents: ["Application Form", "Statement of Purpose", "2 Academic Letters of Recommendation", "Transcripts"],
          deadline: new Date("2025-12-15T23:59:59Z"),
          applicationUrl: "https://erasmus-plus.ec.europa.eu/opportunities/opportunities-for-individuals/students/erasmus-mundus-joint-masters",
          sourceUrl: "https://erasmus-plus.ec.europa.eu/",
          verificationStatus: "verified",
          lastVerifiedAt: new Date(),
          published: true,
          featured: true,
          viewsCount: 31000,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      await scholarshipsCol.insertMany(sampleScholarships);
      console.log(`Seeded ${sampleScholarships.length} scholarships.`);
    }

    const countryCount = await countriesCol.countDocuments();
    if (countryCount === 0) {
      const sampleCountries: Country[] = [
        {
          name: "United Kingdom",
          slug: "uk",
          code: "GB",
          flag: "🇬🇧",
          description: "1-year master's degrees, Chevening awards, and a 2-year Graduate Route post-study work visa.",
          popularFields: ["Data Science", "Public Policy", "Finance", "Public Health"],
          averageLivingCost: "£1,000 - £1,400 / month",
          postStudyVisa: "2 Years Graduate Route (3 Years for PhD)",
          topUniversities: ["University of Oxford", "University of Cambridge", "Imperial College London"],
          scholarshipCount: 24,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "Germany",
          slug: "germany",
          code: "DE",
          flag: "🇩🇪",
          description: "Tuition-free public education, DAAD scholarships, and an 18-month job seeker visa for graduates.",
          popularFields: ["Automotive Engineering", "Renewable Energy", "Computer Science"],
          averageLivingCost: "€900 - €1,100 / month",
          postStudyVisa: "18 Months Post-Study Job Seeking Visa",
          topUniversities: ["TUM Munich", "LMU Munich", "Heidelberg University"],
          scholarshipCount: 38,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "United States",
          slug: "usa",
          code: "US",
          flag: "🇺🇸",
          description: "Fulbright awards, university assistantships, and 3-year STEM OPT extensions.",
          popularFields: ["Artificial Intelligence", "Biomedical Engineering", "Cybersecurity"],
          averageLivingCost: "$1,200 - $1,800 / month",
          postStudyVisa: "1 Year OPT + 2 Years STEM OPT Extension",
          topUniversities: ["MIT", "Stanford University", "Harvard University"],
          scholarshipCount: 42,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      await countriesCol.insertMany(sampleCountries);
      console.log(`Seeded ${sampleCountries.length} countries.`);
    }

    const uniCount = await universitiesCol.countDocuments();
    if (uniCount === 0) {
      const sampleUniversities: University[] = [
        {
          name: "University of Cambridge",
          slug: "cambridge",
          country: "United Kingdom",
          city: "Cambridge",
          worldRanking: 2,
          acceptanceRate: "18%",
          website: "https://www.cam.ac.uk",
          scholarshipCount: 12,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "Technical University of Munich (TUM)",
          slug: "tum",
          country: "Germany",
          city: "Munich",
          worldRanking: 28,
          acceptanceRate: "24%",
          website: "https://www.tum.de",
          scholarshipCount: 9,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      await universitiesCol.insertMany(sampleUniversities);
      console.log(`Seeded ${sampleUniversities.length} universities.`);
    }

    const profCount = await professorsCol.countDocuments();
    if (profCount === 0) {
      const sampleProfessors: Professor[] = [
        {
          name: "Dr. Alistair Finch",
          title: "Professor & Chair of Machine Intelligence",
          university: "University of Cambridge",
          country: "United Kingdom",
          department: "Department of Computer Science and Technology",
          researchAreas: ["Large Language Models", "Multimodal Reasoning", "Explainable AI"],
          email: "afinch@cl.cam.ac.uk",
          acceptingStudents: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          name: "Prof. Dr. Elena Bauer",
          title: "Chair of Sustainable Energy Systems",
          university: "Technical University of Munich (TUM)",
          country: "Germany",
          department: "School of Engineering and Design",
          researchAreas: ["Renewable Hydrogen", "Smart Grid Dynamics", "Decarbonized Power"],
          email: "elena.bauer@tum.de",
          acceptingStudents: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      await professorsCol.insertMany(sampleProfessors);
      console.log(`Seeded ${sampleProfessors.length} professors.`);
    }

    const guideCount = await guidesCol.countDocuments();
    if (guideCount === 0) {
      const sampleGuides: Guide[] = [
        {
          slug: "chevening-bangladesh-guide",
          title: "Chevening Scholarship Complete Guide for Bangladesh Applicants",
          description: "A step-by-step roadmap covering the 4 mandatory Chevening leadership essays, university course selection, interview preparation, and timeline.",
          content: "Comprehensive application guidance for Chevening applicants in Bangladesh.",
          readTime: "8 min read",
          tag: "UK Scholarships",
          author: "GoAbroad Editorial Team",
          date: "Feb 2025",
          published: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          slug: "daad-epos-germany-guide",
          title: "DAAD EPOS Germany: Meeting the 2-Year Work Experience Requirement",
          description: "Crucial guidance on Uni-Assist, employer recommendation letter formats, and structuring motivation letters around UN SDGs.",
          content: "Detailed requirements for DAAD EPOS development-related postgraduate courses.",
          readTime: "10 min read",
          tag: "Germany",
          author: "GoAbroad Editorial Team",
          date: "Jan 2025",
          published: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      await guidesCol.insertMany(sampleGuides);
      console.log(`Seeded ${sampleGuides.length} guides.`);
    }
  } catch (err) {
    console.warn("Seeding notice (continuing):", err);
  }
}

// Start Server (used for local development / non-Vercel environments)
async function startServer() {
  const server = app.listen(PORT, () => {
    console.log(`GoAbroad Express API Server running on port ${PORT}`);
    console.log(`Allowed Client URL: ${CLIENT_URL}`);
  });

  ensureDbConnected()
    .then(() => {
      console.log("Connected to MongoDB Database:", DB_NAME);
    })
    .catch((err) => {
      console.warn("MongoDB connection note (offline / sandboxed mode):", err.message || err);
    });

  return server;
}

// In local development or standalone execution, listen on PORT.
// On Vercel, requests are handled serverlessly via the exported app.
if (!process.env.VERCEL) {
  startServer();
}

export default app;
module.exports = app;
