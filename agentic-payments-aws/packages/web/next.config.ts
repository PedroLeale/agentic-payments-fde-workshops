import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Site estático (out/) servido pelo S3 + CloudFront; o backend são as Lambdas.
  output: "export",
};

export default nextConfig;
