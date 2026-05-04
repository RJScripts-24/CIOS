// [NEW FILE]
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ProjectOwnerOrAdminGuard } from '../../common/guards/project-owner-or-admin.guard';
import { FinanceController } from './finance.controller';

describe('FinanceController guards (metadata)', () => {
  it('GET summary uses RolesGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, FinanceController.prototype.summary)).toEqual(
      expect.arrayContaining([RolesGuard]),
    );
  });

  it('GET export uses RolesGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, FinanceController.prototype.export)).toEqual(
      expect.arrayContaining([RolesGuard]),
    );
  });

  it('GET projectDetail uses ProjectOwnerOrAdminGuard', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, FinanceController.prototype.projectDetail),
    ).toEqual(expect.arrayContaining([ProjectOwnerOrAdminGuard]));
  });
});
