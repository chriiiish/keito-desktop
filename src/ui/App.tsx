import { useEffect, useState } from "react";
import { Popover } from "./Popover.js";
import { ReviewWindow } from "./ReviewWindow.js";

/** Both windows load the same bundle; the hash decides which one this is. */
export function App(): JSX.Element {
  const [route, setRoute] = useState(() => window.location.hash.replace("#", "") || "/popover");

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.replace("#", "") || "/popover");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route === "/window" ? <ReviewWindow /> : <Popover />;
}
