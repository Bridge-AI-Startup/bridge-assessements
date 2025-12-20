import { RequestHandler } from "express";
import { validationResult } from "express-validator";

import { AuthError } from "../errors/auth.js";
import UserModel from "../models/user.ts";
import { firebaseAdminAuth } from "../util/firebase.js";
import validationErrorParser from "../util/validationErrorParser.js";

export type CreateRequest = {
  companyName: string;
  companyLogoUrl?: string | null;
  uid: string; // Added by verifyAuthToken middleware
};

export type LoginRequest = {
  uid: string;
};

export const createUser: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const { companyName, companyLogoUrl, uid } = req.body as CreateRequest;

    // Get Firebase user info to get email
    // The Firebase user was already created by the frontend
    const firebaseUser = await firebaseAdminAuth.getUser(uid);
    const email = firebaseUser.email;

    if (!email) {
      throw new Error("Firebase user does not have an email");
    }

    // email is guaranteed to be string here (not null) due to the check above
    const userEmail: string = email;

    // Check if user already exists in MongoDB
    const existingUser = await UserModel.findOne({ firebaseUid: uid });
    if (existingUser) {
      // Update existing user
      existingUser.companyName = companyName;
      if (companyLogoUrl !== undefined) {
        existingUser.companyLogoUrl = companyLogoUrl ? companyLogoUrl : null;
      }
      await existingUser.save();
      res.status(200).json(existingUser);
      return;
    }

    // Create new user in MongoDB
    const userData: {
      firebaseUid: string;
      companyName: string;
      email: string;
      companyLogoUrl?: string;
    } = {
      firebaseUid: uid,
      companyName,
      email: userEmail,
    };

    if (companyLogoUrl) {
      userData.companyLogoUrl = companyLogoUrl;
    }

    const newUser = await UserModel.create(userData);

    res.status(201).json(newUser);
  } catch (error) {
    next(error);
  }
};

export const loginUser: RequestHandler = async (req, res, next) => {
  const errors = validationResult(req);
  try {
    validationErrorParser(errors);
    const { uid } = req.body as LoginRequest;
    const user = await UserModel.findOne({ firebaseUid: uid });
    if (!user) {
      throw AuthError.INVALID_AUTH_TOKEN;
    }
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
};
