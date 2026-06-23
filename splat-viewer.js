/**
 * Splat viewer entry point. Mounts a SplatStage on every `.splat-stage`
 * element in the document. All real work lives under js/splat/.
 */
import { mountAllSplatStages } from './js/splat/splat-stage.js';

mountAllSplatStages();
