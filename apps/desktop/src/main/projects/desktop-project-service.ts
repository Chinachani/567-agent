import { getDesktopProjectService } from "./project-service-instance.js";

/** All project callers share the same service and config mutation queue. */
export const createDesktopProjectService = getDesktopProjectService;
