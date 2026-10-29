import { useEffect, useState } from "react";
import { fetchServerStatus } from "../api";

export interface ServerStatus {
  serverName: string;
  isOnline: boolean;
  plexUrl: string;
  version?: string;
  loaded: boolean;
}

export function useServerStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>({
    serverName: "Plex",
    isOnline: true,
    plexUrl: "",
    loaded: false,
  });

  useEffect(() => {
    fetchServerStatus()
      .then((data) =>
        setStatus({
          serverName: data.serverName,
          isOnline: data.status === "online",
          plexUrl: data.plexUrl,
          version: data.version,
          loaded: true,
        })
      )
      .catch(() => setStatus((s) => ({ ...s, isOnline: false, loaded: true })));
  }, []);

  return status;
}
