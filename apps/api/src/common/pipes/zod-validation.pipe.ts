import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { ZodSchema } from 'zod';

/** Pipe validate body/query bằng zod schema từ @deploybox/shared. */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'BadRequest',
        message: 'Dữ liệu không hợp lệ',
        details: result.error.flatten().fieldErrors,
      });
    }
    return result.data;
  }
}
