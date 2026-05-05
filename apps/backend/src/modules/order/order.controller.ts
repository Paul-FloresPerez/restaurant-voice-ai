import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AddOrderItemDto } from './dto/add-order-item.dto';
import { CreateCurrentOrderDto } from './dto/create-current-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { UpdateOrderItemDto } from './dto/update-order-item.dto';
import { OrderService } from './order.service';

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post('current')
  createCurrent(@Body() dto: CreateCurrentOrderDto): Promise<OrderResponseDto> {
    return this.orderService.getOrCreateCurrent(dto.sessionId);
  }

  @Get('current/:sessionId')
  findCurrent(
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ): Promise<OrderResponseDto> {
    return this.orderService.findCurrent(sessionId);
  }

  @Post(':orderId/items')
  addItem(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: AddOrderItemDto,
  ): Promise<OrderResponseDto> {
    return this.orderService.addItem(orderId, dto);
  }

  @Patch(':orderId/items/:itemId')
  updateItem(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() dto: UpdateOrderItemDto,
  ): Promise<OrderResponseDto> {
    return this.orderService.updateItem(orderId, itemId, dto);
  }

  @Delete(':orderId/items/:itemId')
  removeItem(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
  ): Promise<OrderResponseDto> {
    return this.orderService.removeItem(orderId, itemId);
  }

  @Post(':orderId/confirm')
  confirm(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
  ): Promise<OrderResponseDto> {
    return this.orderService.confirm(orderId);
  }
}
