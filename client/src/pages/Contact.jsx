import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Mail, Phone, Bug } from "lucide-react";
import { createPageUrl } from "@/utils";
import { auth } from "@/firebase/firebase";
import bridgeLogo from "@/assets/bridge-logo.svg";

export default function Contact() {
  return (
    <div className="min-h-screen bg-white">
      {/* Floating Pill Navigation */}
      <div className="absolute top-4 left-0 right-0 z-50 flex justify-center px-6">
        <nav className="bg-white/80 backdrop-blur-md rounded-full shadow-lg border border-gray-200/50 px-4 py-2 flex items-center justify-between gap-12">
          <div className="flex items-center gap-2">
            <a href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg overflow-hidden flex items-center justify-center">
                <img
                  src={bridgeLogo}
                  alt="Bridge"
                  className="w-full h-full object-contain"
                />
              </div>
              <span className="font-semibold text-gray-900 text-sm">Bridge</span>
            </a>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                window.location.href = createPageUrl("Pricing");
              }}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Pricing
            </Button>
            <Button
              onClick={() => {
                window.location.href = createPageUrl("Contact");
              }}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Contact
            </Button>
            <Button
              onClick={() => {
                const user = auth.currentUser;
                if (user) {
                  window.location.href = createPageUrl("Home");
                } else {
                  window.location.href = createPageUrl("GetStarted");
                }
              }}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Sign In
            </Button>
            <Button
              onClick={() => (window.location.href = createPageUrl("GetStarted"))}
              variant="ghost"
              className="text-gray-700 hover:text-gray-900 rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Sign Up
            </Button>
            <Button
              onClick={() =>
                window.open(
                  "https://calendly.com/smahadkar-ucsd/30min",
                  "_blank"
                )
              }
              className="bg-[#1E3A8A] hover:bg-[#152a66] text-white rounded-full text-sm px-4 py-1.5 h-auto"
            >
              Book a Demo
            </Button>
          </div>
        </nav>
      </div>

      {/* Contact Section */}
      <div className="bg-gradient-to-b from-gray-50 to-white py-24 md:py-32 pt-32">
        <div className="max-w-4xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#1E3A8A]/10 mb-4">
              <Bug className="w-8 h-8 text-[#1E3A8A]" />
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Contact Us
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Found a bug or have a question? Contact us and we'll get back to
              you as soon as possible.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 md:p-12"
          >
            <div className="grid md:grid-cols-2 gap-8">
              {/* Email */}
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-6 h-6 text-[#1E3A8A]" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Email
                  </h3>
                  <a
                    href="mailto:saaz.m@icloud.com"
                    className="text-[#1E3A8A] hover:text-[#152a66] hover:underline transition-colors"
                  >
                    saaz.m@icloud.com
                  </a>
                </div>
              </div>

              {/* Phone */}
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                  <Phone className="w-6 h-6 text-[#1E3A8A]" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Phone
                  </h3>
                  <a
                    href="tel:+18623370989"
                    className="text-[#1E3A8A] hover:text-[#152a66] hover:underline transition-colors"
                  >
                    (862) 337-0989
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

