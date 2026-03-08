export interface ImageBackup {
  id: string;
  containerId: string;
  containerName: string;
  imageName: string;
  imageTag: string;
  imageDigest?: string;
  timestamp: string;
  triggerName: string;
}
