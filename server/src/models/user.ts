// server/models/user.ts
import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    // Firebase Auth UID
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Company name from onboarding
    companyName: {
      type: String,
      required: true,
      trim: true,
    },

    // Email from Firebase Auth
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    // Optional logo field
    companyLogoUrl: {
      type: String,
      default: null,
    },

    // Subscription information (legacy nested structure for backwards compatibility)
    subscription: {
      tier: {
        type: String,
        enum: ["free", "paid"],
        default: "free",
      },
      stripeCustomerId: {
        type: String,
        default: null,
      },
      stripeSubscriptionId: {
        type: String,
        default: null,
      },
      subscriptionStatus: {
        type: String,
        enum: ["active", "canceled", "past_due", "trialing", null],
        default: null,
      },
      currentPeriodEnd: {
        type: Date,
        default: null,
      },
    },

    // Stripe subscription fields (top-level for new implementation)
    stripeCustomerId: {
      type: String,
      default: null,
      sparse: true,
      index: true,
    },
    stripeSubscriptionId: {
      type: String,
      default: null,
      sparse: true,
      index: true,
    },
    subscriptionStatus: {
      type: String,
      enum: [
        "active",
        "canceled",
        "past_due",
        "trialing",
        "incomplete",
        "incomplete_expired",
        "unpaid",
        null,
      ],
      default: null,
    },
    currentPeriodEnd: {
      type: Date,
      default: null,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    cancellationReason: {
      type: String,
      default: null,
      required: false,
    },
    cancellationDate: {
      type: Date,
      default: null,
      required: false,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

const UserModel = mongoose.model("User", UserSchema);
export default UserModel;
