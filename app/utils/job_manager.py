import uuid
import time
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


class JobManager:
    """Utility class for managing processing jobs"""
    
    def __init__(self):
        self.active_jobs: Dict[str, Dict[str, Any]] = {}
    
    def create_job(self, config: Dict[str, Any]) -> str:
        """
        Create a new processing job
        Args:
            config: Job configuration dictionary
        Returns:
            Job ID string
        """
        job_id = str(uuid.uuid4())
        self.active_jobs[job_id] = {
            'id': job_id,
            'status': 'starting',
            'progress': 0,
            'config': config,
            'started_at': time.time(),
            'steps': []
        }
        logger.info(f"Created new job: {job_id}")
        return job_id
    
    def get_job(self, job_id: str) -> Dict[str, Any]:
        """
        Get job by ID
        Args:
            job_id: Job ID to retrieve
        Returns:
            Job dictionary
        Raises:
            ValueError: If job not found
        """
        if job_id not in self.active_jobs:
            logger.error(f"Job not found: {job_id}")
            raise ValueError("Job not found")
        return self.active_jobs[job_id]
    
    def update_job_status(self, job_id: str, status: str, message: str = None) -> None:
        """
        Update job status
        Args:
            job_id: Job ID to update
            status: New status
            message: Optional status message
        """
        job = self.get_job(job_id)
        job['status'] = status
        if message:
            job['status_message'] = message
        logger.debug(f"Updated job {job_id} status to {status}")
    
    def update_job_progress(self, job_id: str, progress: float) -> None:
        """
        Update job progress
        Args:
            job_id: Job ID to update
            progress: Progress value (0-1)
        """
        job = self.get_job(job_id)
        job['progress'] = progress * 100  # Convert to percentage
        logger.debug(f"Updated job {job_id} progress to {progress:.0%}")
    
    def add_job_step(self, job_id: str, message: str, progress: float = None) -> None:
        """
        Add a step to job history
        Args:
            job_id: Job ID to update
            message: Step description
            progress: Optional progress at this step
        """
        job = self.get_job(job_id)
        step = {
            'message': message,
            'time': time.time()
        }
        if progress is not None:
            step['progress'] = progress
        job['steps'].append(step)
        logger.debug(f"Added step to job {job_id}: {message}")
    
    def complete_job(self, job_id: str, results: Dict[str, Any] = None) -> None:
        """
        Mark job as completed
        Args:
            job_id: Job ID to complete
            results: Optional results dictionary
        """
        job = self.get_job(job_id)
        job['status'] = 'completed'
        job['progress'] = 100
        job['completed_at'] = time.time()
        if results:
            job['results'] = results
        logger.info(f"Completed job: {job_id}")
    
    def fail_job(self, job_id: str, error: str) -> None:
        """
        Mark job as failed
        Args:
            job_id: Job ID to fail
            error: Error message
        """
        job = self.get_job(job_id)
        job['status'] = 'failed'
        job['error'] = error
        job['completed_at'] = time.time()
        logger.error(f"Job failed: {job_id} - {error}") 