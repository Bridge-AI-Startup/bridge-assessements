import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { pagesConfig } from "@/pages.config";

export default function NavigationTracker() {
  const location = useLocation();
  const { Pages, mainPage } = pagesConfig;
  const mainPageKey = mainPage ?? Object.keys(Pages)[0];

  // Post navigation changes to parent window
  useEffect(() => {
    window.parent?.postMessage(
      {
        type: "app_changed_url",
        url: window.location.href,
      },
      "*"
    );
  }, [location]);

  return null;
}
