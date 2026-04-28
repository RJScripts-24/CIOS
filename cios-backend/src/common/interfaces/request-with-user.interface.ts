import { FastifyRequest } from 'fastify';
import { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';

export interface RequestWithUser extends FastifyRequest {
  user: JwtPayload;
  projectMembership?: {
    project_id: string;
    user_id: string;
    access_level: string;
    workspace_id: string;
  };
  project?: {
    id: string;
    owner_id: string;
    workspace_id: string;
    [key: string]: any;
  };
}
