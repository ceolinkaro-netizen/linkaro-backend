const { ObjectId } = require("mongodb");
const { getDb } = require("../../config/db");
const { isUserOnline } = require("../../sockets");

const EARTH_RADIUS_KM = 6371;
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function myJobs(req, res) {
  try {
    const db = await getDb();

    const jobs = await db
      .collection("jobs")
      .find({ userId: new ObjectId(req.decoded.id) })
      .sort({ createdAt: -1 })
      .toArray();

    const providerIds = [
      ...new Set(
        jobs
          .filter((job) => job.assignedProviderId)
          .map((job) => job.assignedProviderId.toString())
      ),
    ].map((id) => new ObjectId(id));

    let providerMap = new Map();
    if (providerIds.length) {
      const providers = await db
        .collection("users")
        .find({ _id: { $in: providerIds } })
        .project({
          name: 1,
          profileImage: 1,
          rating: 1,
          categories: 1,
          phone: 1,
          jobsCompleted: 1,
          lastSeenAt: 1,
        })
        .toArray();
      providerMap = new Map(providers.map((p) => [p._id.toString(), p]));
    }

    const now = Date.now();

    const result = jobs.map((job) => {
      const provider = job.assignedProviderId
        ? providerMap.get(job.assignedProviderId.toString())
        : null;
      if (!provider) return job;
      const lastSeenAt = provider.lastSeenAt
        ? new Date(provider.lastSeenAt).getTime()
        : 0;
      return {
        ...job,
        assignedTo: provider.name ?? null,
        providerImage: provider.profileImage ?? null,
        providerRating: provider.rating ?? null,
        providerBusiness: Array.isArray(provider.categories)
          ? provider.categories.join(", ")
          : null,
        providerPhone: provider.phone ?? null,
        providerJobsCompleted: provider.jobsCompleted ?? 0,
        providerIsOnline:
          isUserOnline(job.assignedProviderId.toString()) ||
          now - lastSeenAt <= ONLINE_WINDOW_MS,
        completedBy: job.status === "completed" ? provider.name ?? null : null,
      };
    });

    return res.status(200).json({ success: true, jobs: result });
  } catch (error) {
    console.error("Get my jobs error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function assignProvider(req, res) {
  const { id } = req.params;
  const { providerId } = req.body;

  if (!ObjectId.isValid(id) || !providerId || !ObjectId.isValid(providerId)) {
    return res
      .status(400)
      .json({ message: "Valid job id and providerId are required" });
  }

  try {
    const db = await getDb();

    const job = await db.collection("jobs").findOne({ _id: new ObjectId(id) });

    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    if (job.userId.toString() !== req.decoded.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (job.status !== "open") {
      return res.status(400).json({ message: "Job is not open for assignment" });
    }

    const provider = await db
      .collection("users")
      .findOne({ _id: new ObjectId(providerId), role: "provider" });

    if (!provider) {
      return res.status(404).json({ message: "Provider not found" });
    }

    await db.collection("jobs").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: "in_progress",
          assignedProviderId: new ObjectId(providerId),
          assignedAt: new Date(),
        },
      }
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Assign provider error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function cancelJob(req, res) {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Valid job id is required" });
  }

  try {
    const db = await getDb();

    const job = await db.collection("jobs").findOne({ _id: new ObjectId(id) });

    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    if (job.userId.toString() !== req.decoded.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (job.status !== "open") {
      return res
        .status(400)
        .json({ message: "Only pending jobs can be cancelled" });
    }

    await db.collection("jobs").deleteOne({ _id: new ObjectId(id) });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Cancel job error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function completeJob(req, res) {
  const { id } = req.params;
  const { rating, review } = req.body;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Valid job id is required" });
  }

  const ratingNum = Number(rating);
  if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res
      .status(400)
      .json({ message: "A rating between 1 and 5 is required" });
  }
  if (!review || !review.trim()) {
    return res.status(400).json({ message: "A review is required" });
  }

  try {
    const db = await getDb();

    const job = await db.collection("jobs").findOne({ _id: new ObjectId(id) });

    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    if (job.userId.toString() !== req.decoded.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    if (job.status !== "in_progress") {
      return res
        .status(400)
        .json({ message: "Only in-progress jobs can be completed" });
    }

    await db.collection("jobs").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
          rating: ratingNum,
          review: review.trim(),
        },
      }
    );

    if (job.assignedProviderId) {
      const provider = await db
        .collection("users")
        .findOne(
          { _id: job.assignedProviderId },
          { projection: { rating: 1, jobsCompleted: 1 } }
        );

      const prevCount = provider?.jobsCompleted ?? 0;
      const prevRating = provider?.rating ?? 0;
      const newRating = (prevRating * prevCount + ratingNum) / (prevCount + 1);

      await db.collection("users").updateOne(
        { _id: job.assignedProviderId },
        { $set: { rating: newRating }, $inc: { jobsCompleted: 1 } }
      );
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Complete job error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function postJob(req, res) {
  const { title, category, problem, location, scheduledTime, latitude, longitude } =
    req.body;

  if (!title || !category || !problem || !location) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    const db = await getDb();

    const jobDoc = {
      userId: new ObjectId(req.decoded.id),
      title: title.trim(),
      category,
      problem: problem.trim(),
      location: location.trim(),
      scheduledTime: scheduledTime || "ASAP",
      status: "open",
      createdAt: new Date(),
    };

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      jobDoc.latitude = lat;
      jobDoc.longitude = lng;
    }

    const result = await db.collection("jobs").insertOne(jobDoc);

    await db
      .collection("users")
      .updateOne({ _id: new ObjectId(req.decoded.id) }, { $inc: { totalJobs: 1 } });

    return res.status(201).json({ success: true, jobId: result.insertedId });
  } catch (error) {
    console.error("Post job error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// Jobs near a provider: open jobs matching the provider's categories, within
// `radius` km of the given coordinates, sorted closest-first.
async function nearbyJobs(req, res) {
  try {
    const db = await getDb();

    const provider = await db
      .collection("users")
      .findOne({ _id: new ObjectId(req.decoded.id) });

    if (!provider) {
      return res.status(404).json({ message: "User not found" });
    }

    if (provider.subscriptionStatus !== "active") {
      return res.status(200).json({
        success: true,
        needsSubscription: true,
        needsLocation: false,
        jobs: [],
      });
    }

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(200).json({
        success: true,
        needsSubscription: false,
        needsLocation: true,
        jobs: [],
      });
    }

    const radiusKm = Number(req.query.radius) || 10;
    const categories = Array.isArray(provider.categories)
      ? provider.categories
      : [];

    const rawJobs = await db
      .collection("jobs")
      .find({
        status: "open",
        category: { $in: categories },
        latitude: { $exists: true },
        longitude: { $exists: true },
      })
      .toArray();

    const inRange = rawJobs
      .map((job) => ({
        ...job,
        distanceKm: haversineKm(lat, lng, job.latitude, job.longitude),
      }))
      .filter((job) => job.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const consumerIds = [
      ...new Set(inRange.map((job) => job.userId.toString())),
    ].map((id) => new ObjectId(id));

    const consumers = await db
      .collection("users")
      .find({ _id: { $in: consumerIds } })
      .project({ name: 1, profileImage: 1, lastSeenAt: 1 })
      .toArray();
    const consumerMap = new Map(
      consumers.map((c) => [c._id.toString(), c])
    );

    const now = Date.now();

    const jobs = inRange.map((job) => {
      const consumer = consumerMap.get(job.userId.toString());
      const lastSeenAt = consumer?.lastSeenAt
        ? new Date(consumer.lastSeenAt).getTime()
        : 0;
      return {
        _id: job._id,
        title: job.title,
        category: job.category,
        problem: job.problem,
        location: job.location,
        latitude: job.latitude,
        longitude: job.longitude,
        scheduledTime: job.scheduledTime,
        status: job.status,
        createdAt: job.createdAt,
        distanceKm: job.distanceKm,
        consumerId: job.userId,
        consumerName: consumer?.name ?? null,
        consumerProfileImage: consumer?.profileImage ?? null,
        consumerIsOnline: consumer
          ? isUserOnline(job.userId.toString()) ||
            now - lastSeenAt <= ONLINE_WINDOW_MS
          : false,
      };
    });

    return res.status(200).json({
      success: true,
      needsSubscription: false,
      needsLocation: false,
      jobs,
    });
  } catch (error) {
    console.error("Get nearby jobs error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = {
  myJobs,
  postJob,
  nearbyJobs,
  assignProvider,
  cancelJob,
  completeJob,
};
