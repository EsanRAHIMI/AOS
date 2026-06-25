import { z } from 'zod';
import { IsoDate } from './common.js';

/** Metadata stored in MongoDB for every object written to S3. */
export const S3ObjectSchema = z.object({
  objectId: z.string(),
  bucket: z.string(),
  key: z.string(),
  mimeType: z.string(),
  size: z.number(),
  serviceId: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  checksum: z.string().optional(),
  createdAt: IsoDate,
});
export type S3Object = z.infer<typeof S3ObjectSchema>;
