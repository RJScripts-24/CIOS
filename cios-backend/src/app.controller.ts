import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './modules/auth/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('healthz')
  health() {
    return { status: 'ok' };
  }

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
