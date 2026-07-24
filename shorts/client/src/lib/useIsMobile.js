import { useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 767px)";

function getMatches() {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;
}

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(getMatches);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = (event) => setIsMobile(event.matches);
    setIsMobile(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
