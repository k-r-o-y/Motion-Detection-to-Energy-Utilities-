export async function setupPoseTracking(video) {
    // Placeholder: webcam starts, but no pose model yet.
    // Next phase: replace this with MediaPipe Pose or MoveNet.
    return {
      async estimate() {
        return {
          peopleCount: 0,
          keypoints: []
        };
      }
    };
  }
