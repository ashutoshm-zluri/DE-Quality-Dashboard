import dataDal from "./dataDal.js";
import { storageBackend } from "./storage.js";

// Single env-scoped DAL backed by storage.js (LOCAL or S3).
// `activeDataSource` is preserved for legacy logging in routes/api.js.
const dal = dataDal;

export default dal;
export { storageBackend as activeDataSource };
