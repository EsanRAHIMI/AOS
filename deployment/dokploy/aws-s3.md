# AWS S3

1. Create a bucket (e.g. `simorx-factory-assets`) in your region.
2. Block public access; the system uses **presigned URLs** for read/write.
3. Create an IAM user with least-privilege access to that bucket
   (GetObject, PutObject, DeleteObject, HeadObject).
4. Set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`
   on the **file-asset-service**.
5. Key layout: `factory/{services|agents|tasks|documents|artifacts|images|logs|research}/…`
   Object metadata is tracked in the `s3_objects` MongoDB collection.
