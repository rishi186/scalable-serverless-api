import { z } from 'zod';

export const ItemStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ARCHIVED: 'archived',
} as const;

export const itemSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  category: z.string().min(1).max(100),
  status: z.enum([ItemStatus.ACTIVE, ItemStatus.INACTIVE, ItemStatus.ARCHIVED]).default(ItemStatus.ACTIVE),
});

export const createItemSchema = itemSchema;

export const updateItemSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  category: z.string().min(1).max(100).optional(),
  status: z.enum([ItemStatus.ACTIVE, ItemStatus.INACTIVE, ItemStatus.ARCHIVED]).optional(),
});

export type Item = {
  itemId: string;
  name: string;
  description: string;
  category: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
