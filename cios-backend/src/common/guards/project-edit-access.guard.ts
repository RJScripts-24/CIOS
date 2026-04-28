import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { RequestWithUser } from '../interfaces/request-with-user.interface';

@Injectable()
export class ProjectEditAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (user.role === 'admin') return true;

    const membership = (request as any).projectMembership;

    if (!membership) {
      throw new ForbiddenException(
        'Project membership not resolved - ensure ProjectMemberGuard runs first',
      );
    }

    if (membership.access_level !== 'edit') {
      throw new ForbiddenException('You have read-only access to this project');
    }

    return true;
  }
}
